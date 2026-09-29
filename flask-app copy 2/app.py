from flask import Flask, render_template, request, session, redirect, url_for
import sqlite3
import os
import json
from functools import wraps
from datetime import datetime, timedelta

try:
    from werkzeug.security import generate_password_hash, check_password_hash
except ImportError:
    generate_password_hash = None
    check_password_hash = None

try:
    from authlib.integrations.flask_client import OAuth
except ImportError:
    OAuth = None

app = Flask(__name__)

# =========================================================
# APPLICATION / LOGIN CONFIGURATION
# =========================================================

app.secret_key = os.environ.get(
    "FLASK_SECRET_KEY",
    "smart-inventory-change-this-secret-key"
)

app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")

oauth = OAuth(app) if OAuth is not None else None

if oauth is not None and GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET:
    oauth.register(
        name="google",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )

DATABASE = os.environ.get(
    "INVENTORY_DB",
    os.path.join(os.path.abspath(os.path.dirname(__file__)), "smart_inventory.db")
)


# =========================================================
# DATABASE CONNECTION
# =========================================================

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def column_exists(conn, table, column):
    cols = [
        row["name"]
        for row in conn.execute(
            f"PRAGMA table_info({table})"
        )
    ]
    return column in cols


# =========================================================
# INVENTORY TRANSACTION HELPER
# =========================================================

def add_inventory_transaction(
    conn,
    product_id,
    action,
    quantity
):
    conn.execute("""
        INSERT INTO inventory_transactions
        (product_id, action, quantity)
        VALUES (?, ?, ?)
    """, (
        product_id,
        action,
        quantity
    ))


# =========================================================
# DATABASE INITIALIZATION
# =========================================================

def init_db():

    conn = get_db()

    # -----------------------------------------------------
    # PRODUCTS
    # -----------------------------------------------------

    conn.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barcode TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            category TEXT,
            price REAL,
            quantity REAL DEFAULT 0,
            unit TEXT,
            low_stock_level REAL DEFAULT 5
        )
    """)

    # -----------------------------------------------------
    # INVENTORY TRANSACTIONS
    # -----------------------------------------------------

    conn.execute("""
        CREATE TABLE IF NOT EXISTS inventory_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            quantity REAL NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id)
            REFERENCES products(id)
            ON DELETE CASCADE
        )
    """)

    # -----------------------------------------------------
    # SALES
    # -----------------------------------------------------

    conn.execute("""
        CREATE TABLE IF NOT EXISTS sales (
            sale_id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            quantity_sold REAL NOT NULL,
            total_amount REAL NOT NULL,
            sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id)
            REFERENCES products(id)
        )
    """)

    # -----------------------------------------------------
    # USERS / LOGIN
    # -----------------------------------------------------

    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT UNIQUE,
            mobile TEXT UNIQUE,
            password_hash TEXT,
            name TEXT,
            role TEXT DEFAULT 'staff',
            google_id TEXT UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Create a local admin account only when the users table is empty.
    admin_exists = conn.execute(
        "SELECT id FROM users WHERE username = ?",
        ("admin",)
    ).fetchone()

    if admin_exists is None and generate_password_hash is not None:
        conn.execute("""
            INSERT INTO users
            (username, password_hash, name, role)
            VALUES (?, ?, ?, ?)
        """, (
            "admin",
            generate_password_hash("admin123", method="pbkdf2:sha256"),
            "Administrator",
            "admin"
        ))

    # -----------------------------------------------------
    # SAFE MIGRATIONS
    # -----------------------------------------------------

    new_columns = {

        "expiry_date": "TEXT",

        "brand": "TEXT",

        "mrp": "REAL",

        "supplier": "TEXT",

        "image_url": "TEXT"
    }

    for column, datatype in new_columns.items():

        if not column_exists(
            conn,
            "products",
            column
        ):

            conn.execute(
                f"""
                ALTER TABLE products
                ADD COLUMN {column} {datatype}
                """
            )

    conn.commit()
    conn.close()


# =========================================================
# AUTHENTICATION HELPERS
# =========================================================

PUBLIC_ENDPOINTS = {
    "login",
    "google_login",
    "google_callback",
    "static",
    "health",
}


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapped_view


@app.before_request
def require_login():
    endpoint = request.endpoint

    if endpoint is None:
        return None

    if endpoint in PUBLIC_ENDPOINTS:
        return None

    if "user_id" not in session:
        return redirect(url_for("login"))

    return None


# =========================================================
# LOGIN PAGE
# =========================================================

@app.route("/login", methods=["GET", "POST"])
def login():

    if request.method == "GET":
        if "user_id" in session:
            return redirect(url_for("home"))

        return render_template("login.html")

    # Supports both normal HTML form POST and JSON requests.
    data = request.get_json(silent=True) or {}

    identifier = str(
        data.get(
            "identifier",
            request.form.get(
                "identifier",
                request.form.get("username", "")
            )
        )
    ).strip()

    password = str(
        data.get(
            "password",
            request.form.get("password", "")
        )
    )

    if identifier == "" or password == "":
        if request.is_json:
            return {
                "error": "Username/email/mobile and password are required"
            }, 400

        return render_template(
            "login.html",
            error="Username/email/mobile and password are required"
        ), 400

    conn = get_db()

    user = conn.execute("""
        SELECT *
        FROM users
        WHERE username = ?
           OR email = ?
           OR mobile = ?
        LIMIT 1
    """, (
        identifier,
        identifier,
        identifier
    )).fetchone()

    conn.close()

    if (
        user is None
        or user["password_hash"] is None
        or check_password_hash is None
        or not check_password_hash(user["password_hash"], password)
    ):
        if request.is_json:
            return {"error": "Invalid login credentials"}, 401

        return render_template(
            "login.html",
            error="Invalid username/email/mobile or password"
        ), 401

    session.clear()
    session["user_id"] = user["id"]
    session["username"] = user["username"]
    session["name"] = user["name"]
    session["role"] = user["role"]

    if request.is_json:
        return {
            "message": "Login successful",
            "user": {
                "id": user["id"],
                "username": user["username"],
                "name": user["name"],
                "role": user["role"]
            }
        }

    return redirect(url_for("home"))


# =========================================================
# LOGOUT
# =========================================================

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# =========================================================
# GOOGLE LOGIN
# =========================================================

@app.route("/auth/google")
def google_login():

    if oauth is None:
        return render_template(
            "login.html",
            error="Google login requires Authlib. Run: pip install Authlib"
        ), 500

    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return render_template(
            "login.html",
            error="Google login is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
        ), 500

    redirect_uri = url_for(
        "google_callback",
        _external=True
    )

    return oauth.google.authorize_redirect(
        redirect_uri
    )


@app.route("/auth/google/callback")
def google_callback():

    if oauth is None:
        return render_template(
            "login.html",
            error="Google login requires Authlib."
        ), 500

    try:
        token = oauth.google.authorize_access_token()
        user_info = token.get("userinfo")

        if not user_info:
            user_info = oauth.google.userinfo()

        google_id = str(user_info.get("sub", "")).strip()
        email = str(user_info.get("email", "")).strip().lower()
        name = str(
            user_info.get("name")
            or user_info.get("given_name")
            or "Google User"
        ).strip()

        if google_id == "":
            return render_template(
                "login.html",
                error="Google did not return a valid user ID."
            ), 400

        conn = get_db()

        user = conn.execute("""
            SELECT *
            FROM users
            WHERE google_id = ?
               OR email = ?
            LIMIT 1
        """, (
            google_id,
            email
        )).fetchone()

        if user is None:
            base_username = (
                email.split("@")[0]
                if email and "@" in email
                else "googleuser"
            )

            username = base_username

            counter = 1
            while conn.execute(
                "SELECT id FROM users WHERE username = ?",
                (username,)
            ).fetchone() is not None:
                username = f"{base_username}{counter}"
                counter += 1

            conn.execute("""
                INSERT INTO users
                (username, email, password_hash, name, role, google_id)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                username,
                email or None,
                None,
                name,
                "staff",
                google_id
            ))

            conn.commit()

            user = conn.execute("""
                SELECT *
                FROM users
                WHERE google_id = ?
            """, (
                google_id,
            )).fetchone()

        else:
            # Link Google account to an existing email account if needed.
            if user["google_id"] is None:
                conn.execute("""
                    UPDATE users
                    SET google_id = ?,
                        name = COALESCE(NULLIF(name, ''), ?)
                    WHERE id = ?
                """, (
                    google_id,
                    name,
                    user["id"]
                ))
                conn.commit()

                user = conn.execute("""
                    SELECT *
                    FROM users
                    WHERE id = ?
                """, (
                    user["id"],
                )).fetchone()

        conn.close()

        session.clear()
        session["user_id"] = user["id"]
        session["username"] = user["username"]
        session["name"] = user["name"]
        session["role"] = user["role"]

        return redirect(url_for("home"))

    except Exception:
        return render_template(
            "login.html",
            error="Google login failed. Check your OAuth configuration and redirect URI."
        ), 400


# =========================================================
# CURRENT USER
# =========================================================

@app.route("/me")
def current_user():

    if "user_id" not in session:
        return {
            "logged_in": False
        }

    conn = get_db()

    user = conn.execute("""
        SELECT
            id,
            username,
            email,
            mobile,
            name,
            role,
            created_at
        FROM users
        WHERE id = ?
    """, (
        session["user_id"],
    )).fetchone()

    conn.close()

    if user is None:
        session.clear()
        return {
            "logged_in": False
        }

    return {
        "logged_in": True,
        "user": dict(user)
    }


# =========================================================
# UPDATE PROFILE (NAME)
# =========================================================

@app.route(
    "/update-profile",
    methods=["POST"]
)
def update_profile():

    data = request.get_json(
        silent=True
    ) or {}

    name = str(
        data.get("name", "")
    ).strip()

    if name == "":
        return {
            "error":
            "Name is required"
        }, 400

    conn = get_db()

    conn.execute("""
        UPDATE users
        SET name = ?
        WHERE id = ?
    """, (
        name,
        session["user_id"]
    ))

    conn.commit()
    conn.close()

    session["name"] = name

    return {
        "message":
        "Name updated successfully",
        "name": name
    }


# =========================================================
# CHANGE PASSWORD
# =========================================================

@app.route(
    "/change-password",
    methods=["POST"]
)
def change_password():

    if generate_password_hash is None or check_password_hash is None:
        return {
            "error":
            "Password changes require Werkzeug's security module"
        }, 500

    data = request.get_json(
        silent=True
    ) or {}

    current_password = str(
        data.get("current_password", "")
    )

    new_password = str(
        data.get("new_password", "")
    )

    confirm_password = str(
        data.get("confirm_password", "")
    )

    if new_password == "" or confirm_password == "":
        return {
            "error":
            "New password and confirmation are required"
        }, 400

    if new_password != confirm_password:
        return {
            "error":
            "New password and confirmation do not match"
        }, 400

    if len(new_password) < 6:
        return {
            "error":
            "New password must be at least 6 characters"
        }, 400

    conn = get_db()

    user = conn.execute("""
        SELECT *
        FROM users
        WHERE id = ?
    """, (
        session["user_id"],
    )).fetchone()

    if user is None:
        conn.close()
        return {
            "error":
            "User not found"
        }, 404

    # Accounts created via Google sign-in may not have a local
    # password yet. If one already exists, require and verify it
    # before allowing a change.
    if user["password_hash"] is not None:

        if current_password == "":
            conn.close()
            return {
                "error":
                "Current password is required"
            }, 400

        if not check_password_hash(user["password_hash"], current_password):
            conn.close()
            return {
                "error":
                "Current password is incorrect"
            }, 401

    conn.execute("""
        UPDATE users
        SET password_hash = ?
        WHERE id = ?
    """, (
        generate_password_hash(new_password, method="pbkdf2:sha256"),
        session["user_id"]
    ))

    conn.commit()
    conn.close()

    return {
        "message":
        "Password updated successfully"
    }


# =========================================================
# HEALTH CHECK
# =========================================================

@app.route("/health")
def health():
    return {
        "status": "ok",
        "service": "Smart Inventory"
    }


# =========================================================
# HOME PAGE
# =========================================================

@app.route("/")
def home():

    display_name = (
        session.get("name")
        if session.get("role") == "admin"
        and session.get("name") not in (None, "", "Administrator")
        else session.get("username", "admin")
        if session.get("role") == "admin"
        else session.get("name", "User")
    )

    return render_template(
        "index.html",
        user_name=display_name,
        user_role=session.get("role", "staff")
    )


# =========================================================
# ADD PRODUCT
# =========================================================

@app.route(
    "/add-product",
    methods=["POST"]
)
def add_product():

    data = request.get_json(
        silent=True
    ) or {}

    barcode = str(
        data.get("barcode", "")
    ).strip()

    name = str(
        data.get("name", "")
    ).strip()

    brand = str(
        data.get("brand", "")
    ).strip()

    category = str(
        data.get("category", "")
    ).strip()

    supplier = str(
        data.get("supplier", "")
    ).strip()

    unit = str(
        data.get("unit", "")
    ).strip()

    image_url = str(
        data.get("image_url", "")
    ).strip()

    expiry_date = str(
        data.get("expiry_date", "")
    ).strip() or None

    if barcode == "":
        return {
            "error": "Barcode is required"
        }, 400

    if name == "":
        return {
            "error": "Product name is required"
        }, 400

    if unit == "":
        return {
            "error": "Unit is required"
        }, 400

    # -----------------------------------------------------
    # PRICE / QUANTITY / MRP
    # -----------------------------------------------------

    try:

        price = float(
            data.get("price", 0)
        )

        quantity = float(
            data.get("quantity", 0)
        )

        mrp = float(
            data.get("mrp", 0)
        )

    except (
        TypeError,
        ValueError
    ):

        return {
            "error":
            "Price, MRP and quantity must be numbers"
        }, 400

    if price < 0:

        return {
            "error":
            "Price cannot be negative"
        }, 400

    if mrp < 0:

        return {
            "error":
            "MRP cannot be negative"
        }, 400

    if quantity < 0:

        return {
            "error":
            "Quantity cannot be negative"
        }, 400

    # -----------------------------------------------------
    # LOW STOCK
    # -----------------------------------------------------

    try:

        low_stock_level = float(
            data.get(
                "low_stock_level",
                5
            )
        )

    except (
        TypeError,
        ValueError
    ):

        low_stock_level = 5

    conn = get_db()

    try:

        conn.execute("""
            INSERT INTO products
            (
                barcode,
                name,
                brand,
                category,
                price,
                mrp,
                quantity,
                unit,
                low_stock_level,
                expiry_date,
                supplier,
                image_url
            )

            VALUES (
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?
            )
        """, (

            barcode,
            name,
            brand,
            category,
            price,
            mrp,
            quantity,
            unit,
            low_stock_level,
            expiry_date,
            supplier,
            image_url

        ))

        product_id = conn.execute(
            "SELECT last_insert_rowid()"
        ).fetchone()[0]

        # Record opening stock
        if quantity > 0:

            add_inventory_transaction(
                conn,
                product_id,
                "OPENING_STOCK",
                quantity
            )

        conn.commit()

        return {
            "message":
            "Product added successfully"
        }

    except sqlite3.IntegrityError:

        return {
            "error":
            "Barcode already exists"
        }, 400

    finally:

        conn.close()


# =========================================================
# GET ALL PRODUCTS
# =========================================================

@app.route("/products")
def products():

    conn = get_db()

    data = conn.execute("""
        SELECT *
        FROM products
        ORDER BY id DESC
    """).fetchall()

    conn.close()

    return [
        dict(row)
        for row in data
    ]


# =========================================================
# SEARCH PRODUCT BY BARCODE
# =========================================================

@app.route("/product/<barcode>")
def get_product(barcode):

    conn = get_db()

    product = conn.execute("""
        SELECT *
        FROM products
        WHERE barcode = ?
    """, (
        barcode,
    )).fetchone()

    conn.close()

    if product is None:

        return {
            "error":
            "Product not found"
        }, 404

    return dict(product)


# =========================================================
# SELL PRODUCT
# =========================================================

@app.route(
    "/sell",
    methods=["POST"]
)
def sell_product():

    data = request.get_json(
        silent=True
    ) or {}

    barcode = str(
        data.get("barcode", "")
    ).strip()

    try:

        quantity = float(
            data.get(
                "quantity",
                0
            )
        )

    except (
        TypeError,
        ValueError
    ):

        return {
            "error":
            "Invalid quantity"
        }, 400

    if barcode == "":

        return {
            "error":
            "Barcode is required"
        }, 400

    if quantity <= 0:

        return {
            "error":
            "Quantity must be greater than 0"
        }, 400

    conn = get_db()

    product = conn.execute("""
        SELECT *
        FROM products
        WHERE barcode = ?
    """, (
        barcode,
    )).fetchone()

    if product is None:

        conn.close()

        return {
            "error":
            "Product not found"
        }, 404

    if product["quantity"] < quantity:

        conn.close()

        return {
            "error":
            "Not enough stock"
        }, 400

    total = (
        product["price"] *
        quantity
    )

    # -----------------------------------------------------
    # REDUCE STOCK
    # -----------------------------------------------------

    conn.execute("""
        UPDATE products

        SET quantity =
            quantity - ?

        WHERE barcode = ?
    """, (
        quantity,
        barcode
    ))

    # -----------------------------------------------------
    # SALES RECORD
    # -----------------------------------------------------

    conn.execute("""
        INSERT INTO sales
        (
            product_id,
            quantity_sold,
            total_amount
        )

        VALUES (?, ?, ?)
    """, (
        product["id"],
        quantity,
        total
    ))

    # -----------------------------------------------------
    # INVENTORY TRANSACTION
    # -----------------------------------------------------

    add_inventory_transaction(
        conn,
        product["id"],
        "SALE",
        -quantity
    )

    conn.commit()

    remaining_stock = (
        product["quantity"] -
        quantity
    )

    conn.close()

    return {

        "message":
        "Product sold successfully",

        "product":
        product["name"],

        "quantity_sold":
        quantity,

        "total_amount":
        total,

        "remaining_stock":
        remaining_stock

    }


# =========================================================
# CHECKOUT
# =========================================================

@app.route(
    "/checkout",
    methods=["POST"]
)
def checkout():

    data = request.get_json(
        silent=True
    ) or {}

    items = data.get(
        "items",
        []
    )

    if (
        not isinstance(items, list)
        or len(items) == 0
    ):

        return {
            "error":
            "Cart is empty"
        }, 400

    conn = get_db()

    try:

        # -------------------------------------------------
        # VALIDATE EVERYTHING FIRST
        # -------------------------------------------------

        resolved = []

        for item in items:

            barcode = str(
                item.get(
                    "barcode",
                    ""
                )
            ).strip()

            try:

                quantity = float(
                    item.get(
                        "quantity",
                        0
                    )
                )

            except (
                TypeError,
                ValueError
            ):

                return {
                    "error":
                    "Invalid quantity in cart"
                }, 400

            if (
                barcode == ""
                or quantity <= 0
            ):

                return {
                    "error":
                    "Invalid cart item"
                }, 400

            product = conn.execute(
                """
                SELECT *
                FROM products
                WHERE barcode = ?
                """,
                (
                    barcode,
                )
            ).fetchone()

            if product is None:

                return {
                    "error":
                    f"Product not found for barcode {barcode}"
                }, 404

            if (
                product["quantity"]
                < quantity
            ):

                return {
                    "error":
                    f"Not enough stock for {product['name']}"
                }, 400

            resolved.append(
                (
                    product,
                    quantity
                )
            )

        # -------------------------------------------------
        # PROCESS SALE
        # -------------------------------------------------

        sold_items = []

        grand_total = 0

        for product, quantity in resolved:

            total = (
                product["price"] *
                quantity
            )

            # Reduce stock
            conn.execute("""
                UPDATE products

                SET quantity =
                    quantity - ?

                WHERE barcode = ?
            """, (
                quantity,
                product["barcode"]
            ))

            # Sales record
            conn.execute("""
                INSERT INTO sales
                (
                    product_id,
                    quantity_sold,
                    total_amount
                )

                VALUES (?, ?, ?)
            """, (
                product["id"],
                quantity,
                total
            ))

            # Inventory history
            add_inventory_transaction(
                conn,
                product["id"],
                "SALE",
                -quantity
            )

            grand_total += total

            sold_items.append({

                "name":
                product["name"],

                "barcode":
                product["barcode"],

                "unit":
                product["unit"],

                "quantity_sold":
                quantity,

                "price":
                product["price"],

                "total_amount":
                total

            })

        conn.commit()

        return {

            "message":
            "Sale complete",

            "items":
            sold_items,

            "grand_total":
            grand_total

        }

    finally:

        conn.close()


# =========================================================
# RESTOCK PRODUCT
# =========================================================

@app.route(
    "/restock",
    methods=["POST"]
)
def restock_product():

    data = request.get_json(
        silent=True
    ) or {}

    barcode = str(
        data.get(
            "barcode",
            ""
        )
    ).strip()

    expiry_date = data.get(
        "expiry_date"
    )

    try:

        quantity = float(
            data.get(
                "quantity",
                0
            )
        )

    except (
        TypeError,
        ValueError
    ):

        return {
            "error":
            "Invalid quantity"
        }, 400

    if barcode == "":

        return {
            "error":
            "Barcode is required"
        }, 400

    if quantity <= 0:

        return {
            "error":
            "Quantity must be greater than 0"
        }, 400

    conn = get_db()

    product = conn.execute("""
        SELECT *
        FROM products
        WHERE barcode = ?
    """, (
        barcode,
    )).fetchone()

    if product is None:

        conn.close()

        return {
            "error":
            "Product not found"
        }, 404

    # -----------------------------------------------------
    # UPDATE STOCK
    # -----------------------------------------------------

    if (
        expiry_date is not None
        and str(expiry_date).strip() != ""
    ):

        conn.execute("""
            UPDATE products

            SET
                quantity =
                    quantity + ?,

                expiry_date = ?

            WHERE barcode = ?
        """, (
            quantity,
            str(expiry_date).strip(),
            barcode
        ))

    else:

        conn.execute("""
            UPDATE products

            SET quantity =
                quantity + ?

            WHERE barcode = ?
        """, (
            quantity,
            barcode
        ))

    # -----------------------------------------------------
    # INVENTORY HISTORY
    # -----------------------------------------------------

    add_inventory_transaction(
        conn,
        product["id"],
        "RESTOCK",
        quantity
    )

    conn.commit()

    new_quantity = (
        product["quantity"] +
        quantity
    )

    conn.close()

    return {

        "message":
        "Product restocked successfully",

        "product":
        product["name"],

        "quantity_added":
        quantity,

        "new_quantity":
        new_quantity

    }


# =========================================================
# INVENTORY HISTORY
# =========================================================

@app.route(
    "/inventory-history/<int:product_id>"
)
def inventory_history(product_id):

    conn = get_db()

    data = conn.execute("""
        SELECT

            inventory_transactions.id,

            inventory_transactions.product_id,

            products.name,

            products.barcode,

            inventory_transactions.action,

            inventory_transactions.quantity,

            inventory_transactions.timestamp

        FROM inventory_transactions

        JOIN products

        ON inventory_transactions.product_id =
           products.id

        WHERE inventory_transactions.product_id = ?

        ORDER BY

            inventory_transactions.timestamp DESC,

            inventory_transactions.id DESC

    """, (
        product_id,
    )).fetchall()

    conn.close()

    return [
        dict(row)
        for row in data
    ]


# =========================================================
# SALES HISTORY
# =========================================================

@app.route("/sales")
def sales():

    conn = get_db()

    data = conn.execute("""
        SELECT

            sales.sale_id,

            sales.product_id,

            products.name,

            products.barcode,

            sales.quantity_sold,

            sales.total_amount,

            sales.sale_date

        FROM sales

        JOIN products

        ON sales.product_id =
           products.id

        ORDER BY
            sales.sale_id DESC

    """).fetchall()

    conn.close()

    return [
        dict(row)
        for row in data
    ]


# =========================================================
# LOW STOCK
# =========================================================

@app.route("/low-stock")
def low_stock():

    conn = get_db()

    data = conn.execute("""
        SELECT

            id,

            barcode,

            name,

            category,

            price,

            quantity,

            unit,

            low_stock_level

        FROM products

        WHERE quantity <= low_stock_level

        ORDER BY quantity ASC

    """).fetchall()

    conn.close()

    return [
        dict(row)
        for row in data
    ]


# =========================================================
# EXPIRING SOON
# =========================================================

@app.route("/expiring-soon")
def expiring_soon():

    conn = get_db()

    data = conn.execute("""
        SELECT

            id,

            barcode,

            name,

            category,

            quantity,

            unit,

            expiry_date

        FROM products

        WHERE expiry_date IS NOT NULL

        AND date(expiry_date)
            <= date('now', '+14 days')

        ORDER BY
            date(expiry_date) ASC

    """).fetchall()

    conn.close()

    return [
        dict(row)
        for row in data
    ]


# =========================================================
# DASHBOARD
# =========================================================

@app.route("/dashboard")
def dashboard():

    conn = get_db()

    product_data = conn.execute("""
        SELECT

            COUNT(*) AS total_products,

            COALESCE(
                SUM(quantity),
                0
            ) AS total_stock,

            COALESCE(
                SUM(
                    CASE
                        WHEN quantity <= low_stock_level
                        THEN 1
                        ELSE 0
                    END
                ),
                0
            ) AS low_stock,

            COALESCE(
                SUM(
                    CASE
                        WHEN expiry_date IS NOT NULL

                        AND date(expiry_date)
                            <= date('now', '+14 days')

                        THEN 1

                        ELSE 0

                    END
                ),
                0
            ) AS expiring_soon

        FROM products

    """).fetchone()

    sales_data = conn.execute("""
        SELECT

            COALESCE(
                SUM(total_amount),
                0
            ) AS total_sales

        FROM sales

    """).fetchone()

    today_sales = conn.execute("""
        SELECT

            COALESCE(
                SUM(total_amount),
                0
            ) AS today_sales

        FROM sales

        WHERE date(sale_date)
            = date('now')

    """).fetchone()

    conn.close()

    return {

        "total_products":
        product_data["total_products"],

        "total_stock":
        product_data["total_stock"],

        "low_stock":
        product_data["low_stock"],

        "expiring_soon":
        product_data["expiring_soon"],

        "total_sales":
        sales_data["total_sales"],

        "today_sales":
        today_sales["today_sales"]

    }


# =========================================================
# STOCK HISTORY - DETAILED VIEW
# =========================================================

@app.route("/stock-history")
def stock_history_all():
    """Get complete stock history (all products & transactions)"""
    
    conn = get_db()
    
    data = conn.execute("""
        SELECT
            inventory_transactions.id,
            inventory_transactions.product_id,
            products.name,
            products.barcode,
            products.unit,
            inventory_transactions.action,
            inventory_transactions.quantity,
            inventory_transactions.timestamp,
            products.quantity AS current_stock
        FROM inventory_transactions
        JOIN products
        ON inventory_transactions.product_id = products.id
        ORDER BY inventory_transactions.timestamp DESC
        LIMIT 500
    """).fetchall()
    
    conn.close()
    
    return [dict(row) for row in data]


@app.route("/stock-history/<int:product_id>")
def stock_history_product(product_id):
    """Get stock history for a specific product"""
    
    conn = get_db()
    
    product = conn.execute("""
        SELECT * FROM products WHERE id = ?
    """, (product_id,)).fetchone()
    
    if product is None:
        conn.close()
        return {"error": "Product not found"}, 404
    
    history = conn.execute("""
        SELECT
            id,
            action,
            quantity,
            timestamp
        FROM inventory_transactions
        WHERE product_id = ?
        ORDER BY timestamp DESC
    """, (product_id,)).fetchall()
    
    conn.close()
    
    return {
        "product": dict(product),
        "history": [dict(row) for row in history]
    }


# =========================================================
# STOCK ANALYTICS
# =========================================================

@app.route("/stock-analytics")
def stock_analytics():
    """Get stock trends and analytics data"""
    
    conn = get_db()
    
    # Daily stock movements (last 30 days)
    daily_movements = conn.execute("""
        SELECT
            DATE(timestamp) as date,
            action,
            SUM(quantity) as total_qty
        FROM inventory_transactions
        WHERE timestamp >= datetime('now', '-30 days')
        GROUP BY DATE(timestamp), action
        ORDER BY date
    """).fetchall()
    
    # Product category distribution
    category_stock = conn.execute("""
        SELECT
            category,
            COUNT(*) as product_count,
            SUM(quantity) as total_qty
        FROM products
        WHERE category IS NOT NULL
        GROUP BY category
    """).fetchall()
    
    # Top 10 products by quantity
    top_products = conn.execute("""
        SELECT
            id,
            name,
            quantity,
            unit,
            category
        FROM products
        ORDER BY quantity DESC
        LIMIT 10
    """).fetchall()
    
    # Bottom 10 products (low stock)
    low_products = conn.execute("""
        SELECT
            id,
            name,
            quantity,
            low_stock_level,
            unit,
            category
        FROM products
        WHERE quantity < 100
        ORDER BY quantity ASC
        LIMIT 10
    """).fetchall()
    
    conn.close()
    
    return {
        "daily_movements": [dict(row) for row in daily_movements],
        "category_stock": [dict(row) for row in category_stock],
        "top_products": [dict(row) for row in top_products],
        "low_products": [dict(row) for row in low_products]
    }


# =========================================================
# DEMAND PREDICTION & RECOMMENDATIONS
# =========================================================

@app.route("/demand-forecast")
def demand_forecast():
    """Predict demand for next 7 days based on past sales"""
    
    from datetime import datetime, timedelta
    
    conn = get_db()
    
    # Get sales for past 30 days
    past_sales = conn.execute("""
        SELECT
            DATE(sale_date) as date,
            SUM(quantity_sold) as items_sold,
            COUNT(*) as transaction_count
        FROM sales
        WHERE sale_date >= datetime('now', '-30 days')
        GROUP BY DATE(sale_date)
        ORDER BY date
    """).fetchall()
    
    # Calculate average daily sales
    if past_sales:
        total_items = sum([row['items_sold'] for row in past_sales])
        days_count = len(past_sales)
        avg_daily_sales = total_items / days_count if days_count > 0 else 0
    else:
        avg_daily_sales = 0
    
    # Get product-wise forecast
    product_forecast = conn.execute("""
        SELECT
            products.id,
            products.name,
            products.barcode,
            products.category,
            products.quantity AS current_stock,
            products.unit,
            products.low_stock_level,
            COALESCE(SUM(sales.quantity_sold), 0) as past_7days_sold,
            COUNT(DISTINCT DATE(sales.sale_date)) as days_sold
        FROM products
        LEFT JOIN sales ON products.id = sales.product_id
        AND sales.sale_date >= datetime('now', '-7 days')
        GROUP BY products.id
        ORDER BY past_7days_sold DESC
    """).fetchall()
    
    forecast_data = []
    
    for product in product_forecast:
        # Calculate daily average for this product
        if product['days_sold'] > 0:
            daily_avg = product['past_7days_sold'] / product['days_sold']
        else:
            daily_avg = 0
        
        # Forecast for 7 days
        forecast_7days = daily_avg * 7
        
        # Restock recommendation
        shortage = forecast_7days - product['current_stock']
        recommend_restock = max(0, shortage)
        
        forecast_data.append({
            'product_id': product['id'],
            'name': product['name'],
            'barcode': product['barcode'],
            'category': product['category'],
            'current_stock': product['current_stock'],
            'unit': product['unit'],
            'low_stock_level': product['low_stock_level'],
            'daily_avg_sales': round(daily_avg, 2),
            'forecast_7days': round(forecast_7days, 2),
            'recommend_restock': round(recommend_restock, 2),
            'stock_status': 'critical' if product['current_stock'] <= product['low_stock_level'] else 'ok',
            'urgency': 'high' if recommend_restock > 10 else 'medium' if recommend_restock > 0 else 'low'
        })
    
    conn.close()
    
    return {
        'overall_daily_avg': round(avg_daily_sales, 2),
        'forecast_items': forecast_data,
        'total_products': len(forecast_data)
    }


@app.route("/stockout-prediction")
def stockout_prediction():
    """Estimate stockout risk from current stock and recent sales velocity."""

    conn = get_db()

    rows = conn.execute("""
        SELECT
            products.id,
            products.name,
            products.barcode,
            products.category,
            products.quantity AS current_stock,
            products.unit,
            products.low_stock_level,
            COALESCE(
                SUM(
                    CASE
                        WHEN sales.sale_date >= datetime('now', '-30 days')
                        THEN sales.quantity_sold
                        ELSE 0
                    END
                ),
                0
            ) AS sold_30days
        FROM products
        LEFT JOIN sales
            ON products.id = sales.product_id
        GROUP BY products.id
        ORDER BY products.id DESC
    """).fetchall()

    conn.close()

    result = []

    for row in rows:
        sold_30days = float(row["sold_30days"] or 0)
        current_stock = float(row["current_stock"] or 0)
        daily_demand = sold_30days / 30.0

        if daily_demand > 0:
            days_until_stockout = current_stock / daily_demand
        else:
            days_until_stockout = None

        if current_stock <= 0:
            risk = "out-of-stock"
        elif days_until_stockout is not None and days_until_stockout <= 3:
            risk = "critical"
        elif days_until_stockout is not None and days_until_stockout <= 7:
            risk = "high"
        elif current_stock <= float(row["low_stock_level"] or 0):
            risk = "medium"
        else:
            risk = "low"

        if days_until_stockout is None:
            predicted_date = None
        else:
            predicted_date = (
                datetime.now() +
                timedelta(days=max(0, days_until_stockout))
            ).strftime("%Y-%m-%d")

        result.append({
            "product_id": row["id"],
            "name": row["name"],
            "barcode": row["barcode"],
            "category": row["category"],
            "current_stock": current_stock,
            "unit": row["unit"],
            "low_stock_level": row["low_stock_level"],
            "sold_30days": sold_30days,
            "daily_demand": round(daily_demand, 2),
            "days_until_stockout": (
                round(days_until_stockout, 1)
                if days_until_stockout is not None
                else None
            ),
            "predicted_stockout_date": predicted_date,
            "risk": risk
        })

    return {
        "forecast_period_days": 30,
        "products": result
    }


@app.route("/smart-restock")
def smart_restock():
    """Recommend a practical restock quantity using recent sales velocity."""

    conn = get_db()

    rows = conn.execute("""
        SELECT
            products.id,
            products.name,
            products.barcode,
            products.category,
            products.quantity AS current_stock,
            products.unit,
            products.low_stock_level,
            COALESCE(
                SUM(
                    CASE
                        WHEN sales.sale_date >= datetime('now', '-30 days')
                        THEN sales.quantity_sold
                        ELSE 0
                    END
                ),
                0
            ) AS sold_30days
        FROM products
        LEFT JOIN sales
            ON products.id = sales.product_id
        GROUP BY products.id
        ORDER BY products.id DESC
    """).fetchall()

    conn.close()

    recommendations = []

    for row in rows:
        current_stock = float(row["current_stock"] or 0)
        sold_30days = float(row["sold_30days"] or 0)

        daily_demand = sold_30days / 30.0

        # Keep roughly 14 days of predicted demand as target stock.
        target_stock = daily_demand * 14.0

        # Also respect the configured minimum stock level.
        target_stock = max(
            target_stock,
            float(row["low_stock_level"] or 0)
        )

        recommended_qty = max(
            0,
            target_stock - current_stock
        )

        if recommended_qty > 0:
            if current_stock <= 0:
                priority = "critical"
            elif current_stock <= float(row["low_stock_level"] or 0):
                priority = "high"
            else:
                priority = "medium"
        else:
            priority = "none"

        recommendations.append({
            "product_id": row["id"],
            "name": row["name"],
            "barcode": row["barcode"],
            "category": row["category"],
            "current_stock": current_stock,
            "unit": row["unit"],
            "sold_30days": sold_30days,
            "daily_demand": round(daily_demand, 2),
            "target_stock_14days": round(target_stock, 2),
            "recommended_restock": round(recommended_qty, 2),
            "priority": priority
        })

    recommendations.sort(
        key=lambda item: (
            {"critical": 0, "high": 1, "medium": 2, "none": 3}
            .get(item["priority"], 4),
            -item["recommended_restock"]
        )
    )

    return {
        "recommendations": recommendations
    }


@app.route("/product-classification")
def product_classification():
    """Classify products as fast-moving, normal, or slow-moving"""
    
    from datetime import datetime, timedelta
    
    conn = get_db()
    
    # Get sales velocity for last 30 days
    products_data = conn.execute("""
        SELECT
            products.id,
            products.name,
            products.barcode,
            products.category,
            products.quantity,
            products.unit,
            COALESCE(COUNT(DISTINCT DATE(sales.sale_date)), 0) as days_with_sales,
            COALESCE(SUM(sales.quantity_sold), 0) as total_sold_30days,
            COALESCE(AVG(sales.quantity_sold), 0) as avg_transaction_qty
        FROM products
        LEFT JOIN sales ON products.id = sales.product_id
        AND sales.sale_date >= datetime('now', '-30 days')
        GROUP BY products.id
        ORDER BY total_sold_30days DESC
    """).fetchall()
    
    classified = []
    
    for product in products_data:
        
        if product['total_sold_30days'] == 0:
            classification = 'slow-moving'
            velocity = 0
        else:
            # Calculate velocity score
            velocity = product['total_sold_30days'] / 30
            
            if velocity >= 5:
                classification = 'fast-moving'
            elif velocity >= 1:
                classification = 'normal'
            else:
                classification = 'slow-moving'
        
        classified.append({
            'product_id': product['id'],
            'name': product['name'],
            'barcode': product['barcode'],
            'category': product['category'],
            'current_stock': product['quantity'],
            'unit': product['unit'],
            'classification': classification,
            'velocity_score': round(velocity, 2),
            'total_sold_30days': product['total_sold_30days'],
            'days_with_sales': product['days_with_sales'],
            'avg_transaction_qty': round(product['avg_transaction_qty'], 2)
        })
    
    conn.close()
    
    return classified


@app.route("/sales-analytics")
def sales_analytics():
    """Get sales trends, daily revenue, and top products"""
    
    conn = get_db()
    
    # Daily sales (last 30 days)
    daily_sales = conn.execute("""
        SELECT
            DATE(sale_date) as date,
            COUNT(*) as sale_count,
            SUM(quantity_sold) as items_sold,
            SUM(total_amount) as revenue
        FROM sales
        WHERE sale_date >= datetime('now', '-30 days')
        GROUP BY DATE(sale_date)
        ORDER BY date
    """).fetchall()
    
    # Top selling products (last 30 days)
    top_sellers = conn.execute("""
        SELECT
            products.id,
            products.name,
            products.category,
            SUM(sales.quantity_sold) as total_sold,
            SUM(sales.total_amount) as total_revenue,
            COUNT(*) as sale_count
        FROM sales
        JOIN products ON sales.product_id = products.id
        WHERE sales.sale_date >= datetime('now', '-30 days')
        GROUP BY products.id
        ORDER BY total_sold DESC
        LIMIT 10
    """).fetchall()
    
    # Category-wise sales
    category_sales = conn.execute("""
        SELECT
            products.category,
            COUNT(*) as sale_count,
            SUM(sales.quantity_sold) as items_sold,
            SUM(sales.total_amount) as revenue
        FROM sales
        JOIN products ON sales.product_id = products.id
        WHERE sales.sale_date >= datetime('now', '-30 days')
        GROUP BY products.category
        ORDER BY revenue DESC
    """).fetchall()
    
    # Weekly sales trend
    weekly_sales = conn.execute("""
        SELECT
            STRFTIME('%Y-W%W', sale_date) as week,
            COUNT(*) as sale_count,
            SUM(quantity_sold) as items_sold,
            SUM(total_amount) as revenue
        FROM sales
        WHERE sale_date >= datetime('now', '-90 days')
        GROUP BY week
        ORDER BY week DESC
    """).fetchall()
    
    conn.close()
    
    return {
        "daily_sales": [dict(row) for row in daily_sales],
        "top_sellers": [dict(row) for row in top_sellers],
        "category_sales": [dict(row) for row in category_sales],
        "weekly_sales": [dict(row) for row in weekly_sales]
    }


# =========================================================
# DELETE PRODUCT
# =========================================================

@app.route(
    "/delete-product/<int:id>",
    methods=["DELETE"]
)
def delete_product(id):

    conn = get_db()

    product = conn.execute("""
        SELECT *
        FROM products
        WHERE id = ?
    """, (
        id,
    )).fetchone()

    if product is None:

        conn.close()

        return {
            "error":
            "Product not found"
        }, 404

    sales_count = conn.execute("""
        SELECT COUNT(*)
        FROM sales
        WHERE product_id = ?
    """, (
        id,
    )).fetchone()[0]

    if sales_count > 0:

        conn.close()

        return {
            "error":
            "This product has sales history and cannot be deleted"
        }, 400

    conn.execute("""
        DELETE FROM products
        WHERE id = ?
    """, (
        id,
    ))

    conn.commit()
    conn.close()

    return {
        "message":
        "Product deleted successfully"
    }


# =========================================================
# VENDORX AI INTEGRATION ENDPOINTS
# =========================================================

import subprocess
import threading
import sys

VENDORX_JSON_PATH = os.environ.get(
    "VENDORX_OUTPUT_PATH",
    os.path.join(os.path.abspath(os.path.dirname(__file__)), "vendorx", "vendorx_output.json")
)

VENDORX_SCRIPT_PATH = os.path.join(
    os.path.abspath(os.path.dirname(__file__)),
    "vendorx",
    "camera_vendorx.py"
)

# Holds the running scanner subprocess
_vendorx_process = None
_vendorx_lock = threading.Lock()


def _get_vendorx_process_status():
    global _vendorx_process
    with _vendorx_lock:
        if _vendorx_process is None:
            return "stopped"
        poll = _vendorx_process.poll()
        if poll is None:
            return "running"
        _vendorx_process = None
        return "stopped"


@app.route("/api/vendorx/process-status")
def vendorx_process_status():
    """Return whether the VendorX camera scanner subprocess is running."""
    status = _get_vendorx_process_status()
    return {"scanner_status": status, "running": status == "running"}


@app.route("/api/vendorx/start", methods=["POST"])
def vendorx_start():
    """Launch the VendorX camera scanner as a background subprocess."""
    global _vendorx_process
    with _vendorx_lock:
        # Already running?
        if _vendorx_process is not None and _vendorx_process.poll() is None:
            return {"message": "VendorX scanner is already running", "status": "running"}

        if not os.path.exists(VENDORX_SCRIPT_PATH):
            return {"error": "camera_vendorx.py not found in vendorx/ folder"}, 404

        try:
            log_file = open(os.path.join(os.path.abspath(os.path.dirname(__file__)), "vendorx", "camera.log"), "w")
            _vendorx_process = subprocess.Popen(
                [sys.executable, VENDORX_SCRIPT_PATH],
                cwd=os.path.join(os.path.abspath(os.path.dirname(__file__)), "vendorx"),
                stdout=log_file,
                stderr=subprocess.STDOUT
            )
            return {"message": "VendorX AI scanner started!", "pid": _vendorx_process.pid, "status": "running"}
        except Exception as e:
            return {"error": f"Failed to start scanner: {str(e)}"}, 500


@app.route("/api/vendorx/stop", methods=["POST"])
def vendorx_stop():
    """Stop the running VendorX camera scanner subprocess."""
    global _vendorx_process
    with _vendorx_lock:
        if _vendorx_process is None or _vendorx_process.poll() is not None:
            _vendorx_process = None
            return {"message": "VendorX scanner is not running", "status": "stopped"}
        try:
            _vendorx_process.terminate()
            _vendorx_process.wait(timeout=5)
        except Exception:
            try:
                _vendorx_process.kill()
            except Exception:
                pass
        _vendorx_process = None
        return {"message": "VendorX scanner stopped", "status": "stopped"}


def _convert_ocr_date(date_str):
    if not date_str:
        return None
    date_str = str(date_str).strip().replace("-", "/")
    parts = date_str.split("/")
    if len(parts) == 3:
        d, m, y = parts
        if len(y) == 2:
            y = "20" + y
        return f"{y}-{m.zfill(2)}-{d.zfill(2)}"
    return date_str


@app.route("/api/vendorx/status")
def vendorx_status():
    """Check if the VendorX AI scanner output is available and fresh."""
    exists = os.path.exists(VENDORX_JSON_PATH)
    last_modified = None
    age_seconds = None

    if exists:
        try:
            mtime = os.path.getmtime(VENDORX_JSON_PATH)
            last_modified = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
            age_seconds = round(datetime.now().timestamp() - mtime, 1)
        except Exception:
            pass

    return {
        "configured": True,
        "file_exists": exists,
        "last_modified": last_modified,
        "age_seconds": age_seconds,
        "path": VENDORX_JSON_PATH
    }


@app.route("/api/vendorx/latest")
def vendorx_latest():
    """
    Read the latest detection from VendorX AI scanner and match with database products.
    """
    if not os.path.exists(VENDORX_JSON_PATH):
        return {
            "available": False,
            "message": "VendorX output file not found. Run camera_vendorx.py to start scanning.",
            "products": [],
            "quantity": 0,
            "confidence": 0.0
        }

    try:
        with open(VENDORX_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        return {
            "available": False,
            "error": f"Failed to read VendorX output: {str(e)}",
            "products": []
        }

    conn = get_db()
    detected_products = []

    for item in data.get("products", []):
        name = item.get("name", "").strip()
        qty = int(item.get("quantity", 1))

        # Look up product in inventory database by exact or like name
        db_product = conn.execute("""
            SELECT id, barcode, name, category, price, quantity, unit, low_stock_level, expiry_date, mrp, brand
            FROM products
            WHERE LOWER(name) = LOWER(?)
            LIMIT 1
        """, (name,)).fetchone()

        if not db_product:
            db_product = conn.execute("""
                SELECT id, barcode, name, category, price, quantity, unit, low_stock_level, expiry_date, mrp, brand
                FROM products
                WHERE LOWER(name) LIKE LOWER(?)
                LIMIT 1
            """, (f"%{name}%",)).fetchone()

        if db_product:
            prod_dict = dict(db_product)
            prod_dict["in_database"] = True
            prod_dict["detected_quantity"] = qty
            detected_products.append(prod_dict)
        else:
            detected_products.append({
                "in_database": False,
                "name": name,
                "detected_quantity": qty,
                "price": float(data.get("mrp") or 0.0),
                "mrp": float(data.get("mrp") or 0.0),
                "expiry_date": _convert_ocr_date(data.get("expiry_date")),
                "unit": "pc"
            })

    conn.close()

    mtime = os.path.getmtime(VENDORX_JSON_PATH)
    age_seconds = round(datetime.now().timestamp() - mtime, 1)

    return {
        "available": True,
        "last_updated": datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S"),
        "age_seconds": age_seconds,
        "is_live": age_seconds < 10,
        "quantity": data.get("quantity", 0),
        "confidence": data.get("confidence", 0.0),
        "mrp": data.get("mrp"),
        "manufacturing_date": data.get("manufacturing_date"),
        "expiry_date": data.get("expiry_date"),
        "expiry_date_iso": _convert_ocr_date(data.get("expiry_date")),
        "batch": data.get("batch"),
        "products": detected_products
    }


@app.route("/api/vendorx/quick-add", methods=["POST"])
def vendorx_quick_add():
    """
    Quickly add an uncatalogued VendorX product into the inventory database.
    """
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    barcode = str(data.get("barcode", "")).strip()
    category = str(data.get("category", "General")).strip()
    price = float(data.get("price", 0.0))
    mrp = float(data.get("mrp", price))
    quantity = float(data.get("quantity", 1.0))
    unit = str(data.get("unit", "pc")).strip()
    expiry_date = str(data.get("expiry_date", "")).strip() or None

    if not name:
        return {"error": "Product name is required"}, 400

    if not barcode:
        barcode = "VX" + str(int(datetime.now().timestamp()))[-8:]

    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM products WHERE barcode = ? OR LOWER(name) = LOWER(?)",
        (barcode, name)
    ).fetchone()

    if existing:
        conn.close()
        return {"error": "Product already exists in inventory"}, 400

    cursor = conn.execute("""
        INSERT INTO products (barcode, name, category, price, quantity, unit, low_stock_level, expiry_date, mrp)
        VALUES (?, ?, ?, ?, ?, ?, 5.0, ?, ?)
    """, (barcode, name, category, price, quantity, unit, expiry_date, mrp))

    new_id = cursor.lastrowid
    add_inventory_transaction(conn, new_id, "RESTOCK", quantity)
    conn.commit()
    conn.close()

    return {
        "message": "Product registered successfully",
        "product_id": new_id,
        "barcode": barcode
    }


# =========================================================
# INITIALIZE DATABASE
# =========================================================

init_db()


# =========================================================
# START SERVER
# =========================================================

if __name__ == "__main__":

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True
    )
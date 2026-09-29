# Smart Inventory — Setup

## What changed from your original app.py

- Added an `expiry_date` column to `products` (safe migration — runs once
  automatically, keeps all your existing data, safe to re-run every startup).
- `/add-product` and `/restock` now accept an optional `expiry_date`.
- New `/expiring-soon` route — products expiring within 14 days.
- `/dashboard` now also returns `expiring_soon` and `today_sales`.
- Everything else (`/sell`, `/products`, `/product/<barcode>`, `/sales`,
  `/low-stock`, `/delete-product/<id>`) is unchanged.
- No udhaar/credit system. No popups — low-stock and expiring items live on
  their own **Alerts** tab instead.

## Where to put these files

Put these next to your existing `app.py` (replacing it), keeping the same
folder shape Flask expects:

```
your-project/
  app.py              <- replace with the one here
  templates/
    index.html        <- add this (new folder if you don't have one)
  static/
    style.css         <- add this
    app.js            <- add this
```

Your database stays wherever it already is — `C:\sqlite\smart_inventory.db`
by default (same path your original app.py used). If you'd rather keep the
database file next to app.py instead, set an environment variable before
running:

```
set INVENTORY_DB=smart_inventory.db
python app.py
```

## Run it

```
pip install flask
python app.py
```

Then open http://127.0.0.1:5000 — camera barcode scanning needs
`http://localhost` or `https://`, which this satisfies automatically.

## Tabs

- **Scan** — camera or manual barcode entry, sell or restock. Restocking can
  optionally update the expiry date at the same time (no batch-splitting —
  kept simple, it just overwrites the expiry on that product row).
- **Inventory** — searchable list of everything, tap any item to open it on
  the Scan tab.
- **Alerts** — low-stock and expiring-within-14-days items, both in one
  place, no popups.
- **Dashboard** — totals, today's sales, all-time sales, and a recent sales
  list.

## Cart

The Scan tab now works with a cart: "Add to cart" (instead of selling
instantly) queues items, a cart bar shows the running total, and "Complete
sale" checks out everything at once via a new `/checkout` endpoint. Checkout
is all-or-nothing — if any item in the cart has become unavailable or run
short on stock between adding it and checking out, nothing in that cart is
sold, so stock can't go inconsistent.

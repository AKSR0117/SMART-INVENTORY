import cv2
import json
import re
import os
import sys
import argparse
import numpy as np

# =========================================================
# VENDORX AI - LIVE PRODUCT SCANNER
# YOLO + OCR + MULTI-PRODUCT QUANTITY + JSON
# =========================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL_PATH = os.path.join(BASE_DIR, "weights", "best.pt")
DEFAULT_OUTPUT_PATH = os.path.join(BASE_DIR, "vendorx_output.json")

PRODUCT_NAMES = {
    0: "Haldiram's Lite Mixture",
    1: "Nutberry Muesli Dark Chocolate",
    2: "Swisse Magnesium",
    3: "Kayakalp Taila",
    4: "Cantabil Vintage Deo",
    5: "Swasari Pravahi",
    6: "Psorogrit",
    7: "Fevigum Lime"
}

CONFIDENCE = 0.25
OCR_INTERVAL = 30
OCR_SCALE = 2.5

def parse_args():
    parser = argparse.ArgumentParser(description="VendorX AI Live Product Scanner")
    parser.add_argument("--model", default=DEFAULT_MODEL_PATH, help="Path to YOLO .pt model weights")
    parser.add_argument("--output", default=DEFAULT_OUTPUT_PATH, help="Path to output JSON file")
    parser.add_argument("--camera", type=int, default=0, help="Camera device index (default: 0)")
    parser.add_argument("--no-gui", action="store_true", help="Run without opening preview window")
    return parser.parse_args()

args = parse_args()
model_path = args.model if os.path.exists(args.model) else os.path.join(BASE_DIR, "weights", "yolo26n.pt")
output_path = args.output

# =========================================================
# LOAD MODELS
# =========================================================

print(f"Loading YOLO model from: {model_path}")
try:
    from ultralytics import YOLO
    model = YOLO(model_path)
except Exception as e:
    print(f"Error loading YOLO model: {e}")
    print("Ensure ultralytics is installed: pip install ultralytics")
    sys.exit(1)

print("Loading OCR engine...")
try:
    from rapidocr_onnxruntime import RapidOCR
    ocr = RapidOCR()
except Exception as e:
    print(f"Warning: RapidOCR not loaded ({e}). Running detection without OCR.")
    ocr = None

print("Models initialized successfully.")

# =========================================================
# CAMERA INITIALIZATION
# =========================================================

cap = cv2.VideoCapture(args.camera, cv2.CAP_DSHOW)
if not cap.isOpened() and args.camera == 0:
    print("Camera 0 failed, trying camera index 1 with DSHOW...")
    cap = cv2.VideoCapture(1, cv2.CAP_DSHOW)

if not cap.isOpened():
    print("Error: Could not open camera. Please check webcam connection.")
    sys.exit(1)

cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

print(f"Camera started. Outputting detections to: {output_path}")
print("Hold product in front of camera.")
print("Press 'q' in preview window to exit.")

# =========================================================
# OCR HELPERS
# =========================================================

def normalize_ocr_text(text):
    text = str(text).strip()
    replacements = {
        "—": "-",
        "–": "-",
        "₹": "Rs.",
        "O": "0",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text

def normalize_date(date_text):
    date_text = date_text.replace("-", "/")
    parts = date_text.split("/")
    if len(parts) != 3:
        return date_text
    day, month, year = parts
    if len(year) == 2:
        year = "20" + year
    return f"{day.zfill(2)}/{month.zfill(2)}/{year}"

def extract_information(texts):
    clean_texts = [normalize_ocr_text(t) for t in texts if str(t).strip()]
    full_text = " ".join(clean_texts)

    # MRP Extraction
    mrp = None
    mrp_patterns = [
        r"(?:MRP|M\.R\.P)[^0-9]{0,30}(?:Rs\.?\s*)?(\d+(?:\.\d+)?)",
        r"(\d+(?:\.\d+)?)\s*/-\s*\(?(?:INCL|INCLUDING)",
        r"\b(\d+(?:\.\d+)?)\s*/-"
    ]
    for pattern in mrp_patterns:
        match = re.search(pattern, full_text, re.IGNORECASE)
        if match:
            try:
                mrp = float(match.group(1))
                if mrp.is_integer():
                    mrp = int(mrp)
                break
            except ValueError:
                pass

    # Dates (MFD & EXP)
    date_pattern = r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b"
    all_dates = []
    for text in clean_texts:
        matches = re.findall(date_pattern, text)
        all_dates.extend(matches)

    dates = []
    seen_dates = set()
    for d in all_dates:
        normalized = normalize_date(d)
        if normalized not in seen_dates:
            seen_dates.add(normalized)
            dates.append(normalized)

    manufacturing_date = None
    expiry_date = None

    for i, text in enumerate(clean_texts):
        lower = text.lower()
        nearby = " ".join(clean_texts[max(0, i - 1):min(len(clean_texts), i + 2)])

        date_match = re.search(date_pattern, nearby)
        if date_match:
            found_date = normalize_date(date_match.group(0))
            if any(x in lower for x in ["mfg", "mfd", "manufactur", "m.o.d"]):
                manufacturing_date = found_date
            if any(x in lower for x in ["exp", "expiry", "expire"]):
                expiry_date = found_date

        inline = re.search(r"(?:mfg|mfd|manufactur)[^0-9]{0,20}" + date_pattern, text, re.IGNORECASE)
        if inline:
            dm = re.search(date_pattern, inline.group(0))
            if dm:
                manufacturing_date = normalize_date(dm.group(0))

        inline = re.search(r"(?:exp|expiry|expire)[^0-9]{0,20}" + date_pattern, text, re.IGNORECASE)
        if inline:
            dm = re.search(date_pattern, inline.group(0))
            if dm:
                expiry_date = normalize_date(dm.group(0))

    if manufacturing_date is None and expiry_date is None:
        if len(dates) >= 2:
            manufacturing_date = dates[-2]
            expiry_date = dates[-1]
        elif len(dates) == 1:
            manufacturing_date = dates[0]
    elif manufacturing_date is None and len(dates) >= 2:
        for d in reversed(dates):
            if d != expiry_date:
                manufacturing_date = d
                break
    elif expiry_date is None and len(dates) >= 2:
        for d in reversed(dates):
            if d != manufacturing_date:
                expiry_date = d
                break

    # Batch / Lot
    batch = None
    batch_patterns = [
        r"(?:BATCH|BATCH\s*NO|LOT|LOT\s*NO)\s*[:.]?\s*([A-Z0-9./-]{4,})",
        r"\b\d+(?:\.\d+)?/[A-Z0-9]{4,}\b"
    ]
    for pattern in batch_patterns:
        match = re.search(pattern, full_text, re.IGNORECASE)
        if match:
            batch = match.group(1) if match.lastindex else match.group(0)
            break

    return {
        "mrp": mrp,
        "manufacturing_date": manufacturing_date,
        "expiry_date": expiry_date,
        "batch": batch
    }

def run_product_ocr(product_crop):
    if ocr is None or product_crop is None or product_crop.size == 0:
        return {"mrp": None, "manufacturing_date": None, "expiry_date": None, "batch": None}

    enlarged = cv2.resize(product_crop, None, fx=OCR_SCALE, fy=OCR_SCALE, interpolation=cv2.INTER_CUBIC)
    try:
        result, _ = ocr(enlarged)
        texts = []
        if result:
            for item in result:
                if len(item) < 3:
                    continue
                text = str(item[1]).strip()
                confidence = float(item[2])
                if text and confidence >= 0.35:
                    texts.append(text)
        return extract_information(texts)
    except Exception as e:
        print("OCR Error:", e)
        return {"mrp": None, "manufacturing_date": None, "expiry_date": None, "batch": None}

def save_json(data):
    try:
        tmp_path = output_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as file:
            json.dump(data, file, indent=4, ensure_ascii=False)
        os.replace(tmp_path, output_path)
    except Exception as e:
        print("Error saving JSON:", e)

def draw_panel(frame, data):
    h, w = frame.shape[:2]
    panel_width = 420
    panel = np.ones((h, panel_width, 3), dtype=np.uint8) * 255

    # Header
    cv2.putText(panel, "VENDORX AI", (20, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (0, 0, 0), 2)
    cv2.putText(panel, "SMART INVENTORY SCANNER", (20, 64), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (80, 80, 80), 1)

    detected = data["quantity"] > 0
    status = "PRODUCT DETECTED" if detected else "NO PRODUCT DETECTED"
    cv2.putText(panel, status, (20, 105), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (0, 120, 0) if detected else (80, 80, 80), 2)

    y = 145
    cv2.putText(panel, "Products:", (20, y), cv2.FONT_HERSHEY_SIMPLEX, 0.50, (70, 70, 70), 1)
    y += 28

    if data["products"]:
        for product in data["products"]:
            text = f'{product["name"]}: {product["quantity"]}'
            cv2.putText(panel, text, (20, y), cv2.FONT_HERSHEY_SIMPLEX, 0.46, (0, 0, 0), 1)
            y += 30
    else:
        cv2.putText(panel, "None", (20, y), cv2.FONT_HERSHEY_SIMPLEX, 0.46, (0, 0, 0), 1)
        y += 30

    fields = [
        ("Total Quantity", str(data["quantity"])),
        ("MRP", "Rs. " + str(data["mrp"]) if data["mrp"] is not None else "Scanning..."),
        ("MFD", str(data["manufacturing_date"]) if data["manufacturing_date"] is not None else "Scanning..."),
        ("EXP", str(data["expiry_date"]) if data["expiry_date"] is not None else "Scanning..."),
        ("Batch", str(data["batch"]) if data["batch"] is not None else "Scanning..."),
        ("Confidence", f'{data["confidence"]:.2f}')
    ]

    for label, value in fields:
        cv2.putText(panel, label + ":", (20, y), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (70, 70, 70), 1)
        value_size = 0.37 if len(value) > 25 else 0.48
        cv2.putText(panel, value, (155, y), cv2.FONT_HERSHEY_SIMPLEX, value_size, (0, 0, 0), 1)
        y += 32

    return cv2.hconcat([frame, panel])

# =========================================================
# MAIN LOOP
# =========================================================

frame_count = 0
current_data = {
    "products": [],
    "quantity": 0,
    "mrp": None,
    "manufacturing_date": None,
    "expiry_date": None,
    "batch": None,
    "confidence": 0.0
}

try:
    while True:
        ret, frame = cap.read()
        if not ret:
            # Fallback to a dummy frame if the physical camera is unavailable
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(frame, "Webcam Unavailable", (150, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            # Sleep slightly to simulate frame rate and avoid 100% CPU usage
            import time
            time.sleep(0.1)

        frame_count += 1
        results = model(frame, conf=CONFIDENCE, verbose=False)
        result = results[0]

        counts = {}
        highest_confidence = 0.0

        if result.boxes is not None and len(result.boxes) > 0:
            for box in result.boxes:
                confidence = float(box.conf[0])
                class_id = int(box.cls[0])
                highest_confidence = max(highest_confidence, confidence)
                product_name = PRODUCT_NAMES.get(class_id, f"Product Class {class_id}")
                counts[product_name] = counts.get(product_name, 0) + 1

        total_quantity = sum(counts.values())
        product_list = [{"name": name, "quantity": qty} for name, qty in counts.items()]

        if total_quantity == 0:
            current_data = {
                "products": [],
                "quantity": 0,
                "mrp": None,
                "manufacturing_date": None,
                "expiry_date": None,
                "batch": None,
                "confidence": 0.0
            }
        else:
            current_data["products"] = product_list
            current_data["quantity"] = total_quantity
            current_data["confidence"] = highest_confidence

            if frame_count % OCR_INTERVAL == 0 and ocr is not None:
                try:
                    best_box = max(result.boxes, key=lambda b: float(b.conf[0]))
                    x1, y1, x2, y2 = map(int, best_box.xyxy[0].tolist())
                    h, w = frame.shape[:2]
                    pad_x = int((x2 - x1) * 0.03)
                    pad_y = int((y2 - y1) * 0.03)
                    x1, y1 = max(0, x1 - pad_x), max(0, y1 - pad_y)
                    x2, y2 = min(w, x2 + pad_x), min(h, y2 + pad_y)

                    product_crop = frame[y1:y2, x1:x2]
                    extracted = run_product_ocr(product_crop)

                    if extracted["mrp"] is not None:
                        current_data["mrp"] = extracted["mrp"]
                    if extracted["manufacturing_date"] is not None:
                        current_data["manufacturing_date"] = extracted["manufacturing_date"]
                    if extracted["expiry_date"] is not None:
                        current_data["expiry_date"] = extracted["expiry_date"]
                    if extracted["batch"] is not None:
                        current_data["batch"] = extracted["batch"]
                except Exception as e:
                    print("OCR Crop Error:", e)

        save_json(current_data)

        if not args.no_gui:
            annotated_frame = result.plot()
            final_frame = draw_panel(annotated_frame, current_data)
            cv2.imshow("VendorX AI - Live Product Scanner", final_frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

finally:
    cap.release()
    if not args.no_gui:
        cv2.destroyAllWindows()
    print("VendorX AI scanner stopped.")

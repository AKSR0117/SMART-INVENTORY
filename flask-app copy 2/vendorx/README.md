# VendorX AI — Live Product Scanner & OCR

This module integrates YOLO object detection and RapidOCR to scan retail product packaging, automatically counting quantities and extracting MRP, Expiry Dates, and Batch numbers in real time.

---

### Folder Structure
```text
vendorx/
├── weights/
│   ├── best.pt         <- Trained YOLO weights (Train-7)
│   └── yolo26n.pt      <- Base YOLO model
├── dataset/            <- Product images, annotations, and training runs
├── camera_vendorx.py   <- Main live AI scanner (YOLO + OCR + JSON sync)
├── vendorx_output.json <- Live output synced with the Flask Smart Inventory app
├── data.yaml           <- YOLO dataset configuration
└── README.md           <- This guide
```

---

### How to Run the AI Scanner

#### 1. Install AI dependencies:
```powershell
pip install -r ../requirements-ai.txt
```

#### 2. Run the scanner:
```powershell
python camera_vendorx.py
```

* Hold product packets in front of the webcam.
* The scanner outputs live detections to `vendorx_output.json`.
* The Flask Web App automatically syncs with this file via `/api/vendorx/latest` and enables one-click import into the cart or inventory!

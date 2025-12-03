# Scripts

Utility scripts for testing, development, and ML pipeline integration.

## Available Scripts

### YOLOv8 ML Pipeline (`yolov8_ml_pipeline.py`)

End-to-end integration test for the ML analysis feature using real YOLOv8 object detection.

**Quick Start:**
```bash
# Set HMAC secret
# in the scripts folder
source ../.env

# Run pipeline on a project (auto-installs dependencies)
./run_yolov8_pipeline.sh <project_id> --install-deps --limit 5

# View results at http://localhost:3000 in the ML Analyses panel
```

**What it does:**
- Fetches images from a project via API
- Runs YOLOv8 object detection (80 COCO classes: person, car, dog, etc.)
- Creates bounding box + heatmap visualizations
- Uploads artifacts to S3/MinIO
- Submits annotations with HMAC authentication
- Completes full analysis lifecycle (queued → processing → completed)

**Model sizes:** `n` (nano/fast), `s` (small), `m` (medium), `l` (large), `x` (xlarge)

**Full documentation:** [README_YOLOV8.md](./README_YOLOV8.md)

---

### Test ML Pipeline (`test_ml_pipeline.py`)

Mock ML pipeline for testing without running real models.

```bash
export ML_CALLBACK_HMAC_SECRET='your-secret'
python test_ml_pipeline.py --image-id <image_uuid>
```

Simulates external ML pipeline behavior with mock annotations.

---

## Requirements

**For YOLOv8 pipeline:**
```bash
pip install -r ml_requirements.txt
```

**For test pipeline:**
- Standard Python 3.8+ (requests, hmac)

## Environment Variables

- `ML_CALLBACK_HMAC_SECRET` - Required for ML pipeline authentication (HMAC)
- `API_KEY` - API key used by ML scripts when calling API endpoints

These are normally loaded from the project root `.env` file by the Python and shell scripts in this folder. If you change either value in `.env`, restart the backend so FastAPI picks up the new secrets; otherwise HMAC checks on `/api-ml` endpoints will continue to fail with 401.

## Usage Examples

```bash
# YOLOv8 pipeline with nano model (CPU-friendly)
./run_yolov8_pipeline.sh abc-123-def --model-size n --limit 5

# YOLOv8 with GPU-optimized large model
./run_yolov8_pipeline.sh abc-123-def --model-size l --limit 20

# Mock pipeline for quick testing
python test_ml_pipeline.py --image-id abc-123-def

# Custom API endpoint
./run_yolov8_pipeline.sh abc-123 --api-url https://api.example.com
```

## File Structure

```
scripts/
├── README.md                    # This file
├── README_YOLOV8.md            # Detailed YOLOv8 documentation
├── yolov8_ml_pipeline.py       # YOLOv8 integration script
├── run_yolov8_pipeline.sh      # Bash wrapper for YOLOv8
├── ml_requirements.txt         # ML dependencies
└── test_ml_pipeline.py         # Mock pipeline tester
```

## Troubleshooting

**HMAC secret missing:**
```bash
source ../.env  # or set manually
export ML_CALLBACK_HMAC_SECRET='your-secret'
```

**Dependencies not installed:**
```bash
./run_yolov8_pipeline.sh <project_id> --install-deps
```

**No images found:**
Upload images to your project first via the web UI.

**API not running:**
```bash
cd ../backend && ./run.sh
```

## Next Steps

1. Run YOLOv8 pipeline on test project
2. View results in ML Analyses panel
3. Export annotations as JSON/CSV
4. Integrate into CI/CD for automated testing
5. Deploy as containerized ML service

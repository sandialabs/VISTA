# YOLOv8 ML Pipeline Integration Test

End-to-end integration test for the ML analysis feature using real YOLOv8 object detection.

## What It Does

1. **Fetches images** from a specified project via the API
2. **Runs YOLOv8 object detection** on each image (real ML model)
3. **Creates visualizations** (annotated images + heatmaps)
4. **Uploads artifacts** to S3/MinIO via presigned URLs
5. **Submits annotations** (bounding boxes + metadata) to the ML API
6. **Updates analysis status** through the complete lifecycle (queued → processing → completed)

This simulates a real external ML pipeline and validates the entire integration.

## Requirements

### System Dependencies

The following system libraries are required for OpenCV (automatically checked by the script):

```bash
sudo apt-get update
sudo apt-get install -y libgl1-mesa-glx libglib2.0-0
```

These are needed for OpenCV's image processing capabilities.

### Software Requirements

- Python 3.8+
- ML dependencies (auto-installed with `--install-deps` flag)
- Running backend API (with ML_ANALYSIS_ENABLED=true)
- HMAC secret configured

## Quick Start

### 1. Set up environment

```bash
# Source your .env file (contains ML_CALLBACK_HMAC_SECRET)
cd /workspaces/yet-another-image-project-app
source .env

# Or set manually:
export ML_CALLBACK_HMAC_SECRET='your-secret-here'
```

### 2. Run the pipeline

```bash
# Basic usage (installs dependencies automatically)
./scripts/run_yolov8_pipeline.sh <project_id> --install-deps

# With options
./scripts/run_yolov8_pipeline.sh <project_id> \
  --model-size n \
  --limit 5 \
  --api-url http://localhost:8000
```

### 3. View results

1. Open the web UI at http://localhost:3000
2. Navigate to your project
3. Click on any processed image
4. Check the **ML Analyses** panel in the sidebar
5. Toggle overlays to see bounding boxes and heatmaps

## Command Options

```
./scripts/run_yolov8_pipeline.sh <project_id> [options]

Arguments:
    project_id          UUID of the project to process

Options:
    --api-url URL       API base URL (default: http://localhost:8000)
    --api-key KEY       API key for authentication (optional)
    --model-size SIZE   YOLOv8 model size: n|s|m|l|x (default: n)
                        n=nano (fastest, CPU-friendly)
                        s=small
                        m=medium
                        l=large
                        x=xlarge (most accurate, GPU recommended)
    --limit N           Maximum images to process (default: 10)
    --install-deps      Install ML dependencies before running
    --help              Show help message
```

## Model Sizes

| Model | Speed | Accuracy | Best For |
|-------|-------|----------|----------|
| `n` (nano) | ⚡⚡⚡⚡⚡ | ⭐⭐ | CPU testing, quick runs |
| `s` (small) | ⚡⚡⚡⚡ | ⭐⭐⭐ | Balanced performance |
| `m` (medium) | ⚡⚡⚡ | ⭐⭐⭐⭐ | Good accuracy |
| `l` (large) | ⚡⚡ | ⭐⭐⭐⭐⭐ | High accuracy |
| `x` (xlarge) | ⚡ | ⭐⭐⭐⭐⭐⭐ | Maximum accuracy |

**Recommendation:** Use `n` for CPU testing, `m` or `l` for GPU systems.

## Examples

```bash
# Test with 5 images using nano model (fast)
./scripts/run_yolov8_pipeline.sh abc-123-def --model-size n --limit 5 --install-deps

# Process 20 images with medium model
./scripts/run_yolov8_pipeline.sh abc-123-def --model-size m --limit 20

# Use custom API endpoint
./scripts/run_yolov8_pipeline.sh abc-123-def \
  --api-url https://api.myserver.com \
  --api-key my-secret-key

# Run with GPU-optimized large model
./scripts/run_yolov8_pipeline.sh abc-123-def --model-size l --limit 100
```

## What Gets Created

For each image, the pipeline creates:

1. **ML Analysis Record**
   - Status tracking (queued → processing → completed)
   - Model metadata (name, version, parameters)
   - Timestamps

2. **Annotations**
   - Bounding boxes for each detected object
   - Class labels (person, car, dog, etc.)
   - Confidence scores
   - Bounding box coordinates

3. **Artifacts** (uploaded to S3/MinIO)
   - `heatmap_<analysis_id>.png` - Confidence heatmap visualization
   - `annotated_<analysis_id>.jpg` - Image with bounding boxes drawn

4. **Heatmap Metadata**
   - Width/height dimensions
   - Storage path reference

## Detected Object Classes

YOLOv8 can detect 80 object classes from the COCO dataset:

**Common objects:** person, bicycle, car, motorcycle, airplane, bus, train, truck, boat, traffic light, fire hydrant, stop sign, parking meter, bench, bird, cat, dog, horse, sheep, cow, elephant, bear, zebra, giraffe, backpack, umbrella, handbag, tie, suitcase, frisbee, skis, snowboard, sports ball, kite, baseball bat, baseball glove, skateboard, surfboard, tennis racket, bottle, wine glass, cup, fork, knife, spoon, bowl, banana, apple, sandwich, orange, broccoli, carrot, hot dog, pizza, donut, cake, chair, couch, potted plant, bed, dining table, toilet, tv, laptop, mouse, remote, keyboard, cell phone, microwave, oven, toaster, sink, refrigerator, book, clock, vase, scissors, teddy bear, hair drier, toothbrush

## Troubleshooting

### HMAC Secret Error
```
❌ ML_CALLBACK_HMAC_SECRET environment variable is required
```
**Solution:** Source your `.env` file or set the variable:
```bash
source .env
# or
export ML_CALLBACK_HMAC_SECRET='your-secret-here'
```

### Missing System Libraries
```
❌ Missing required system libraries for OpenCV
```
**Solution:** Install system dependencies:
```bash
sudo apt-get update
sudo apt-get install -y libgl1-mesa-glx libglib2.0-0
```

### ultralytics Not Found
```
❌ ultralytics package not found
```
**Solution:** Install dependencies:
```bash
./scripts/run_yolov8_pipeline.sh <project_id> --install-deps
# or manually
pip3 install -r scripts/ml_requirements.txt
```

### No Images Found
```
⚠️  No images found in project
```
**Solution:** Upload images to the project first via the web UI.

### API Connection Error
```
❌ Error processing image: Connection refused
```
**Solution:** Ensure backend is running:
```bash
cd backend && ./run.sh
```

### Model Size Not Recognized
```
❌ Invalid model size: z (must be n|s|m|l|x)
```
**Solution:** Use valid model size: `n`, `s`, `m`, `l`, or `x`

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    YOLOv8 Pipeline Flow                      │
└─────────────────────────────────────────────────────────────┘

1. Fetch Images
   GET /api/projects/{project_id}/images
   └─> Returns list of image IDs

2. For each image:

   a) Download Image
      GET /api/images/{image_id}/download
      └─> Returns image binary

   b) Create Analysis
      POST /api/images/{image_id}/analyses
      └─> Returns analysis_id (status: queued)

   c) Update Status
      PATCH /api/analyses/{analysis_id}/status
      └─> Set status: processing (HMAC signed)

   d) Run YOLOv8 Detection (local)
      └─> Generates bounding boxes + heatmap

   e) Upload Heatmap
      POST /api/analyses/{analysis_id}/artifacts/presign
      └─> Get presigned URL (HMAC signed)
      PUT {presigned_url}
      └─> Upload PNG to S3/MinIO

   f) Upload Annotated Image
      POST /api/analyses/{analysis_id}/artifacts/presign
      └─> Get presigned URL (HMAC signed)
      PUT {presigned_url}
      └─> Upload JPG to S3/MinIO

   g) Submit Annotations
      POST /api/analyses/{analysis_id}/annotations:bulk
      └─> Bounding boxes + heatmap metadata (HMAC signed)

   h) Finalize
      POST /api/analyses/{analysis_id}/finalize
      └─> Set status: completed (HMAC signed)

3. View in UI
   └─> ML Analyses panel shows results with overlays
```

## Python API Usage

You can also use the Python script directly:

```python
from scripts.yolov8_ml_pipeline import YOLOv8Pipeline

# Initialize pipeline
pipeline = YOLOv8Pipeline(
    api_base_url='http://localhost:8000',
    hmac_secret='your-secret',
    api_key='optional-api-key'
)

# Run on project
pipeline.run_project_pipeline(
    project_id='abc-123-def',
    model_size='n',
    limit=10
)
```

## Performance Tips

1. **Use GPU for larger models:**
   - Ensure PyTorch with CUDA is installed
   - Use model sizes `m`, `l`, or `x`

2. **Optimize for CPU:**
   - Use nano model (`n`)
   - Reduce image count with `--limit`

3. **Batch processing:**
   - Process multiple projects sequentially
   - Monitor S3/MinIO storage usage

4. **Network optimization:**
   - Run pipeline close to API server
   - Use local MinIO for development

## Next Steps

After running the pipeline:

1. **Verify in UI:**
   - Check ML Analyses panel
   - Toggle overlays (bounding boxes, heatmap)
   - Adjust opacity slider
   - Try side-by-side view

2. **Export results:**
   - Use JSON export for annotations
   - Use CSV export for tabular data

3. **Integrate with CI/CD:**
   - Add to automated testing pipeline
   - Monitor analysis success rate
   - Track model performance metrics

4. **Scale up:**
   - Deploy as containerized service
   - Add queue/worker pattern (Celery, RQ)
   - Implement batch processing
   - Add GPU acceleration

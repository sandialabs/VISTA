# ML Analysis API Integration Guide

This guide provides comprehensive documentation for integrating machine learning pipelines with the VISTA application.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Authentication](#authentication)
4. [ML Analysis Workflow](#ml-analysis-workflow)
5. [API Endpoints](#api-endpoints)
6. [Data Formats](#data-formats)
7. [Example Integration](#example-integration)
8. [Testing](#testing)
9. [Best Practices](#best-practices)
10. [Troubleshooting](#troubleshooting)

## Overview

The ML Analysis feature allows external machine learning pipelines to submit analysis results for visualization in the web interface. This enables teams to:

- View object detection bounding boxes
- Visualize segmentation heatmaps
- Access classification scores and feature detections
- Export analysis results as JSON or CSV
- Compare multiple ML models on the same images

**Key Concepts:**

- **ML Analysis** - A complete analysis run on an image by a specific model
- **ML Annotation** - Individual detection/feature within an analysis (bounding box, point, etc.)
- **ML Artifact** - Binary output files stored in S3 (visualizations, processed images)
- **HMAC Authentication** - Secure authentication for pipeline endpoints

## Prerequisites

### Application Configuration

The ML Analysis feature must be enabled in the application configuration:

```bash
# Required settings in .env
ML_ANALYSIS_ENABLED=true
ML_CALLBACK_HMAC_SECRET=<your-secure-secret>
ML_ALLOWED_MODELS=yolo_v8,resnet50,custom_model
```

### Generate HMAC Secret

```bash
# Generate a secure secret (32 bytes recommended)
openssl rand -hex 32

# Example output:
# a7f3d9e2c4b8f1a6e9d4c2b7f5a8e3d1c9b6f4a2e7d5c3b1f8a6e4d2c7b5f3a9
```

Store this secret securely:
- In environment variables
- In a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
- Never commit to version control

### Required Libraries

For Python implementations:

```bash
pip install requests boto3
```

For Node.js implementations:

```bash
npm install axios aws-sdk crypto
```

## Authentication

The ML Analysis API uses two authentication mechanisms:

### 1. User Authentication (Initial Request)

The initial analysis creation uses standard user authentication:

**Headers Required:**
- `X-User-Email`: User's email address
- `X-Proxy-Secret`: Shared secret (production)
- OR `X-API-Key`: User's API key

### 2. HMAC Authentication (Pipeline Callbacks)

All pipeline callback endpoints require HMAC-SHA256 authentication to prevent unauthorized submissions.

**Python Example:**

```python
import hmac
import hashlib
import time
import json

def create_hmac_headers(payload, secret):
    """Create HMAC authentication headers."""
    timestamp = str(int(time.time()))
    
    # Create message to sign
    message = json.dumps(payload, separators=(',', ':'), sort_keys=True)
    
    # Generate HMAC signature
    signature = hmac.new(
        secret.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    return {
        'Content-Type': 'application/json',
        'X-ML-Signature': signature,
        'X-ML-Timestamp': timestamp
    }

# Usage
headers = create_hmac_headers(payload, ML_CALLBACK_HMAC_SECRET)
response = requests.post(url, json=payload, headers=headers)
```

**Node.js Example:**

```javascript
const crypto = require('crypto');

function createHMACHeaders(payload, secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    
    // Create message to sign
    const message = JSON.stringify(payload);
    
    // Generate HMAC signature
    const signature = crypto
        .createHmac('sha256', secret)
        .update(message)
        .digest('hex');
    
    return {
        'Content-Type': 'application/json',
        'X-ML-Signature': signature,
        'X-ML-Timestamp': timestamp
    };
}

// Usage
const headers = createHMACHeaders(payload, process.env.ML_CALLBACK_HMAC_SECRET);
const response = await axios.post(url, payload, { headers });
```

**Security Notes:**
- Signatures are time-sensitive (timestamp validated to prevent replay attacks)
- Message must be JSON string with consistent formatting
- Use constant-time comparison on server side
- Rotate secrets periodically

## ML Analysis Workflow

The complete workflow consists of 6 steps:

```
1. Create Analysis (queued)
   ↓
2. Update Status (processing)
   ↓
3. Request Presigned URLs
   ↓
4. Upload Artifacts to S3
   ↓
5. Submit Annotations
   ↓
6. Finalize Analysis (completed)
```

### Step-by-Step Process

**Step 1: Create Analysis**

Initiates a new ML analysis for an image.

```bash
POST /api/images/{image_id}/analyses
```

**Step 2: Update Status to Processing**

Marks the analysis as actively processing.

```bash
PATCH /api/analyses/{analysis_id}/status
```

**Step 3: Request Presigned URLs**

Gets secure upload URLs for artifacts.

```bash
POST /api/analyses/{analysis_id}/artifacts/presign
```

**Step 4: Upload Artifacts**

Uploads binary files (images, visualizations) to S3.

```bash
PUT <presigned_url>
```

**Step 5: Submit Annotations**

Submits detected features (bounding boxes, points, etc.).

```bash
POST /api/analyses/{analysis_id}/annotations:bulk
```

**Step 6: Finalize Analysis**

Marks analysis as completed.

```bash
POST /api/analyses/{analysis_id}/finalize
```

## API Endpoints

### Create Analysis

**Endpoint:** `POST /api/images/{image_id}/analyses`

**Authentication:** User authentication (API key or headers)

**Request Body:**

```json
{
  "model_name": "yolo_v8",
  "model_version": "v8.0.0",
  "parameters": {
    "confidence_threshold": 0.5,
    "iou_threshold": 0.45
  },
  "description": "Object detection using YOLOv8"
}
```

**Response (201 Created):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "image_id": "660e8400-e29b-41d4-a716-446655440001",
  "model_name": "yolo_v8",
  "model_version": "v8.0.0",
  "status": "queued",
  "parameters": {...},
  "created_at": "2024-01-15T10:30:00Z"
}
```

### Update Analysis Status

**Endpoint:** `PATCH /api/analyses/{analysis_id}/status`

**Authentication:** HMAC required

**Request Body:**

```json
{
  "status": "processing"
}
```

**Valid Status Values:**
- `queued` - Initial state
- `processing` - Analysis in progress
- `completed` - Successfully completed
- `failed` - Analysis failed
- `cancelled` - Cancelled by user/system

**Response (200 OK):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "updated_at": "2024-01-15T10:31:00Z"
}
```

### Request Presigned URLs

**Endpoint:** `POST /api/analyses/{analysis_id}/artifacts/presign`

**Authentication:** HMAC required

**Request Body:**

```json
{
  "artifacts": [
    {
      "artifact_name": "bounding_boxes.png",
      "content_type": "image/png"
    },
    {
      "artifact_name": "heatmap.png",
      "content_type": "image/png"
    }
  ]
}
```

**Response (200 OK):**

```json
{
  "presigned_urls": [
    {
      "artifact_name": "bounding_boxes.png",
      "upload_url": "https://s3.amazonaws.com/bucket/path?signature=...",
      "expires_in": 3600
    },
    {
      "artifact_name": "heatmap.png",
      "upload_url": "https://s3.amazonaws.com/bucket/path?signature=...",
      "expires_in": 3600
    }
  ]
}
```

### Upload Artifacts to S3

**Endpoint:** Presigned URL from previous step

**Method:** `PUT`

**Headers:**
- `Content-Type`: Must match the content type from presign request

**Body:** Binary file content

**Example with Python:**

```python
import requests

# Upload file
with open('bounding_boxes.png', 'rb') as f:
    response = requests.put(
        presigned_url,
        data=f,
        headers={'Content-Type': 'image/png'}
    )

print(f"Upload status: {response.status_code}")
```

### Submit Annotations

**Endpoint:** `POST /api/analyses/{analysis_id}/annotations:bulk`

**Authentication:** HMAC required

**Request Body:**

```json
{
  "annotations": [
    {
      "annotation_type": "bounding_box",
      "class_name": "person",
      "confidence": 0.95,
      "data": {
        "bbox": [100, 150, 50, 100],
        "format": "xywh"
      }
    },
    {
      "annotation_type": "bounding_box",
      "class_name": "car",
      "confidence": 0.87,
      "data": {
        "bbox": [300, 200, 120, 80],
        "format": "xywh"
      }
    }
  ]
}
```

**Annotation Types:**
- `bounding_box` - Object detection boxes
- `segmentation` - Polygon or mask segmentation
- `keypoint` - Individual point detections
- `classification` - Image-level classification
- `heatmap` - Attention or saliency maps

**Response (201 Created):**

```json
{
  "created_count": 2,
  "annotations": [
    {
      "id": "770e8400-e29b-41d4-a716-446655440000",
      "annotation_type": "bounding_box",
      "class_name": "person",
      "confidence": 0.95
    },
    {
      "id": "880e8400-e29b-41d4-a716-446655440000",
      "annotation_type": "bounding_box",
      "class_name": "car",
      "confidence": 0.87
    }
  ]
}
```

### Finalize Analysis

**Endpoint:** `POST /api/analyses/{analysis_id}/finalize`

**Authentication:** HMAC required

**Request Body:**

```json
{
  "status": "completed",
  "summary": {
    "total_detections": 25,
    "processing_time_seconds": 3.45,
    "classes_detected": ["person", "car", "bicycle"]
  }
}
```

**Response (200 OK):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "completed_at": "2024-01-15T10:35:00Z"
}
```

## Data Formats

### Bounding Box Format

**XYWH (X, Y, Width, Height):**

```json
{
  "annotation_type": "bounding_box",
  "class_name": "person",
  "confidence": 0.95,
  "data": {
    "bbox": [100, 150, 50, 100],
    "format": "xywh"
  }
}
```

Where:
- `bbox[0]` (100) - X coordinate of top-left corner
- `bbox[1]` (150) - Y coordinate of top-left corner
- `bbox[2]` (50) - Width of box
- `bbox[3]` (100) - Height of box

**XYXY (X1, Y1, X2, Y2):**

```json
{
  "data": {
    "bbox": [100, 150, 150, 250],
    "format": "xyxy"
  }
}
```

### Segmentation Format

**Polygon:**

```json
{
  "annotation_type": "segmentation",
  "class_name": "person",
  "confidence": 0.92,
  "data": {
    "points": [
      [100, 150],
      [120, 140],
      [150, 160],
      [140, 180],
      [100, 175]
    ],
    "format": "polygon"
  }
}
```

**RLE (Run-Length Encoding):**

```json
{
  "annotation_type": "segmentation",
  "class_name": "car",
  "confidence": 0.89,
  "data": {
    "rle": {
      "counts": [12, 5, 8, 3, 15, 2],
      "size": [480, 640]
    },
    "format": "rle"
  }
}
```

### Keypoint Format

```json
{
  "annotation_type": "keypoint",
  "class_name": "person",
  "confidence": 0.93,
  "data": {
    "keypoints": [
      {"name": "nose", "x": 125, "y": 160, "confidence": 0.95},
      {"name": "left_eye", "x": 120, "y": 155, "confidence": 0.92},
      {"name": "right_eye", "x": 130, "y": 155, "confidence": 0.91}
    ]
  }
}
```

### Classification Format

```json
{
  "annotation_type": "classification",
  "class_name": "dog",
  "confidence": 0.96,
  "data": {
    "scores": {
      "dog": 0.96,
      "cat": 0.03,
      "bird": 0.01
    }
  }
}
```

## Example Integration

### Complete Python Pipeline

```python
import requests
import hmac
import hashlib
import time
import json
from pathlib import Path

class MLPipelineClient:
    def __init__(self, api_url, hmac_secret, api_key=None):
        self.api_url = api_url.rstrip('/')
        self.hmac_secret = hmac_secret
        self.api_key = api_key
        
    def _create_hmac_headers(self, payload):
        """Create HMAC authentication headers."""
        timestamp = str(int(time.time()))
        message = json.dumps(payload, separators=(',', ':'), sort_keys=True)
        
        signature = hmac.new(
            self.hmac_secret.encode('utf-8'),
            message.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()
        
        return {
            'Content-Type': 'application/json',
            'X-ML-Signature': signature,
            'X-ML-Timestamp': timestamp
        }
    
    def _get_user_headers(self):
        """Get user authentication headers."""
        if self.api_key:
            return {'X-API-Key': self.api_key}
        return {}
    
    def create_analysis(self, image_id, model_name, model_version, parameters=None):
        """Step 1: Create a new ML analysis."""
        url = f"{self.api_url}/api/images/{image_id}/analyses"
        payload = {
            'model_name': model_name,
            'model_version': model_version,
            'parameters': parameters or {}
        }
        
        response = requests.post(
            url,
            json=payload,
            headers=self._get_user_headers()
        )
        response.raise_for_status()
        return response.json()
    
    def update_status(self, analysis_id, status):
        """Step 2: Update analysis status."""
        url = f"{self.api_url}/api/analyses/{analysis_id}/status"
        payload = {'status': status}
        
        response = requests.patch(
            url,
            json=payload,
            headers=self._create_hmac_headers(payload)
        )
        response.raise_for_status()
        return response.json()
    
    def request_presigned_urls(self, analysis_id, artifacts):
        """Step 3: Request presigned URLs for artifact uploads."""
        url = f"{self.api_url}/api/analyses/{analysis_id}/artifacts/presign"
        payload = {'artifacts': artifacts}
        
        response = requests.post(
            url,
            json=payload,
            headers=self._create_hmac_headers(payload)
        )
        response.raise_for_status()
        return response.json()
    
    def upload_artifact(self, presigned_url, file_path, content_type):
        """Step 4: Upload artifact to S3 using presigned URL."""
        with open(file_path, 'rb') as f:
            response = requests.put(
                presigned_url,
                data=f,
                headers={'Content-Type': content_type}
            )
        response.raise_for_status()
    
    def submit_annotations(self, analysis_id, annotations):
        """Step 5: Submit annotations in bulk."""
        url = f"{self.api_url}/api/analyses/{analysis_id}/annotations:bulk"
        payload = {'annotations': annotations}
        
        response = requests.post(
            url,
            json=payload,
            headers=self._create_hmac_headers(payload)
        )
        response.raise_for_status()
        return response.json()
    
    def finalize_analysis(self, analysis_id, status='completed', summary=None):
        """Step 6: Finalize the analysis."""
        url = f"{self.api_url}/api/analyses/{analysis_id}/finalize"
        payload = {
            'status': status,
            'summary': summary or {}
        }
        
        response = requests.post(
            url,
            json=payload,
            headers=self._create_hmac_headers(payload)
        )
        response.raise_for_status()
        return response.json()

def run_ml_analysis(image_id, image_path):
    """Complete ML analysis workflow example."""
    client = MLPipelineClient(
        api_url='http://localhost:8000',
        hmac_secret='your-hmac-secret',
        api_key='your-api-key'
    )
    
    # Step 1: Create analysis
    print("Creating analysis...")
    analysis = client.create_analysis(
        image_id=image_id,
        model_name='yolo_v8',
        model_version='v8.0.0',
        parameters={'confidence_threshold': 0.5}
    )
    analysis_id = analysis['id']
    print(f"Analysis created: {analysis_id}")
    
    # Step 2: Update to processing
    print("Updating status to processing...")
    client.update_status(analysis_id, 'processing')
    
    # Run your ML model here
    # results = run_yolo_model(image_path)
    
    # Step 3 & 4: Upload artifacts
    print("Uploading artifacts...")
    artifacts = [
        {'artifact_name': 'detections.png', 'content_type': 'image/png'}
    ]
    presigned = client.request_presigned_urls(analysis_id, artifacts)
    
    for url_info in presigned['presigned_urls']:
        # Generate visualization
        # create_detection_visualization(results, 'detections.png')
        client.upload_artifact(
            url_info['upload_url'],
            'detections.png',
            'image/png'
        )
    
    # Step 5: Submit annotations
    print("Submitting annotations...")
    annotations = [
        {
            'annotation_type': 'bounding_box',
            'class_name': 'person',
            'confidence': 0.95,
            'data': {'bbox': [100, 150, 50, 100], 'format': 'xywh'}
        }
    ]
    client.submit_annotations(analysis_id, annotations)
    
    # Step 6: Finalize
    print("Finalizing analysis...")
    client.finalize_analysis(
        analysis_id,
        status='completed',
        summary={'total_detections': len(annotations)}
    )
    
    print("Analysis complete!")

# Run the pipeline
if __name__ == '__main__':
    run_ml_analysis(
        image_id='your-image-id',
        image_path='/path/to/image.jpg'
    )
```

## Testing

### Using the Test Script

The repository includes a test script for quick validation:

```bash
# Set environment variables
export ML_CALLBACK_HMAC_SECRET='your-secret'
export API_KEY='your-api-key'

# Run test pipeline
python scripts/test_ml_pipeline.py --image-id <image_uuid>
```

### YOLOv8 Integration Test

For testing with real object detection:

```bash
cd scripts

# Set HMAC secret
source ../.env

# Run YOLOv8 pipeline
./run_yolov8_pipeline.sh <project_id> --install-deps --limit 5
```

See `scripts/README_YOLOV8.md` for detailed documentation.

### Manual Testing with curl

**Create analysis:**

```bash
curl -X POST http://localhost:8000/api/images/{image_id}/analyses \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model_name": "test_model",
    "model_version": "1.0.0"
  }'
```

**Update status (with HMAC):**

```bash
# Generate signature in Python:
# python -c "import hmac, hashlib, json; \
#   payload = '{\"status\":\"processing\"}'; \
#   print(hmac.new(b'secret', payload.encode(), hashlib.sha256).hexdigest())"

curl -X PATCH http://localhost:8000/api/analyses/{analysis_id}/status \
  -H "Content-Type: application/json" \
  -H "X-ML-Signature: <generated_signature>" \
  -H "X-ML-Timestamp: $(date +%s)" \
  -d '{"status":"processing"}'
```

## Best Practices

### Error Handling

Always implement robust error handling:

```python
def safe_api_call(func, *args, **kwargs):
    """Wrapper for safe API calls with retry logic."""
    max_retries = 3
    retry_delay = 5
    
    for attempt in range(max_retries):
        try:
            return func(*args, **kwargs)
        except requests.exceptions.RequestException as e:
            if attempt < max_retries - 1:
                print(f"Attempt {attempt + 1} failed: {e}")
                print(f"Retrying in {retry_delay} seconds...")
                time.sleep(retry_delay)
            else:
                print(f"All {max_retries} attempts failed")
                raise
```

### Logging

Log all important steps for debugging:

```python
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

logger.info(f"Creating analysis for image {image_id}")
logger.info(f"Analysis {analysis_id} created successfully")
logger.warning(f"Low confidence detection: {confidence}")
logger.error(f"Failed to upload artifact: {error}")
```

### Performance Optimization

**Batch Processing:**

```python
# Process multiple images in parallel
from concurrent.futures import ThreadPoolExecutor

def process_image(image_id):
    # Run analysis pipeline
    pass

with ThreadPoolExecutor(max_workers=4) as executor:
    executor.map(process_image, image_ids)
```

**Artifact Compression:**

```python
from PIL import Image

# Compress images before upload
img = Image.open('detection.png')
img.save('detection_compressed.png', optimize=True, quality=85)
```

### Security

- Never log HMAC secrets or API keys
- Use environment variables for sensitive data
- Validate all inputs before processing
- Implement rate limiting
- Monitor for unusual activity

### Model Versioning

Track model versions for reproducibility:

```python
analysis = client.create_analysis(
    image_id=image_id,
    model_name='yolo_v8',
    model_version='v8.0.0',
    parameters={
        'confidence_threshold': 0.5,
        'iou_threshold': 0.45,
        'model_checkpoint': 'epoch_100',
        'training_date': '2024-01-15'
    }
)
```

## Troubleshooting

### HMAC Authentication Failed

**Error:** `401 Unauthorized - Invalid HMAC signature`

**Solutions:**
1. Verify HMAC secret matches backend configuration
2. Ensure JSON payload formatting is consistent
3. Check timestamp is recent (not expired)
4. Verify signature generation algorithm

**Debug:**

```python
# Print payload being signed
print("Payload:", json.dumps(payload, separators=(',', ':'), sort_keys=True))

# Print signature
print("Signature:", signature)
print("Timestamp:", timestamp)
```

### Presigned URL Expired

**Error:** `403 Forbidden` when uploading to S3

**Solutions:**
1. Upload immediately after receiving URL
2. Request new presigned URL if expired
3. Check URL expiration time

### Annotation Validation Failed

**Error:** `400 Bad Request - Invalid annotation format`

**Solutions:**
1. Verify annotation_type is supported
2. Check bbox format matches specification
3. Ensure confidence is between 0 and 1
4. Validate class_name is provided

### Upload Failed

**Error:** Upload to S3 fails

**Solutions:**
1. Check Content-Type header matches presign request
2. Verify file exists and is readable
3. Check network connectivity
4. Confirm S3 credentials are valid

### Model Not Allowed

**Error:** `400 Bad Request - Model not in allowed list`

**Solution:** Add model to `ML_ALLOWED_MODELS` in backend configuration:

```bash
ML_ALLOWED_MODELS=yolo_v8,resnet50,your_model_name
```

## Additional Resources

- **API Documentation:** http://localhost:8000/docs (Swagger UI)
- **Test Scripts:** `/scripts/` directory
- **Example Pipelines:** `scripts/yolov8_ml_pipeline.py`
- **User Guide:** `/docs/user-guide.md` (viewing ML results in UI)
- **Developer Guide:** `/docs/developer-guide.md`

## Support

For issues or questions:

1. Check this guide and API documentation
2. Review test scripts for working examples
3. Check application logs for detailed error messages
4. Contact system administrator or team lead

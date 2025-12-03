# ML Pipeline Integration Guide

This guide explains how to integrate an external machine learning pipeline with the VISTA platform to visualize analysis results.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Environment Setup](#environment-setup)
- [HMAC Authentication](#hmac-authentication)
- [Analysis Lifecycle](#analysis-lifecycle)
- [Annotation Data Formats](#annotation-data-formats)
- [Error Handling & Retries](#error-handling--retries)
- [Testing](#testing)
- [Best Practices](#best-practices)

---

## Overview

The ML Analysis feature allows external ML pipelines to:
1. Create analysis jobs for images
2. Upload result artifacts (heatmaps, masks, etc.) to object storage
3. Post structured annotations (bounding boxes, classifications, etc.)
4. Track analysis status through completion

**Key Principle**: The platform does NOT perform ML inference—it only orchestrates, stores, and visualizes results from external pipelines.

---

## Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌────────────┐
│ ML Pipeline │ ◄─────► │ VISTA            │ ◄─────► │ S3/MinIO   │
│ (External)  │  HTTPS  │ API              │  Direct │ (Storage)  │
└─────────────┘         └──────────────────┘         └────────────┘
      │                          │
      │                          ▼
      │                  ┌──────────────┐
      └─────────────────►│ PostgreSQL   │
          (via API)      │ (Metadata)   │
                         └──────────────┘
```

**Data Flow**:
1. Pipeline creates analysis → Platform returns `analysis_id`
2. Pipeline requests presigned upload URL → Platform generates URL
3. Pipeline uploads artifact → Directly to S3/MinIO (bypassing API)
4. Pipeline posts annotations → Platform stores metadata in PostgreSQL
5. Pipeline finalizes → Platform marks analysis complete
6. Users view results → Platform serves annotations & presigned download URLs for artifacts

---

## Environment Setup

### Required Environment Variables

```bash
# Backend (.env or environment)
ML_ANALYSIS_ENABLED=true
ML_CALLBACK_HMAC_SECRET="your_secure_secret_key_here"
ML_PIPELINE_REQUIRE_HMAC=true
ML_ALLOWED_MODELS="yolo_v8,resnet50_classifier,custom_model"
ML_MAX_ANALYSES_PER_IMAGE=50
ML_MAX_BULK_ANNOTATIONS=5000
ML_PRESIGNED_URL_EXPIRY_SECONDS=900

# S3/MinIO Configuration (for artifact storage)
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=ml-outputs
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
```

### Pipeline Environment

Your ML pipeline should set:

```bash
API_BASE_URL=http://localhost:8000
ML_CALLBACK_HMAC_SECRET="same_secret_as_backend"
```

---

## HMAC Authentication

All pipeline callback endpoints (status updates, artifact uploads, annotations) require HMAC-SHA256 authentication.

### Why HMAC?

- **Integrity**: Prevents request tampering
- **Authenticity**: Verifies requests come from authorized pipelines
- **Replay Protection**: Timestamps prevent old requests from being reused

### How to Generate HMAC Signatures

#### Python Example

```python
import hmac
import hashlib
import time
import json
import requests

def generate_hmac_headers(body_dict: dict, secret: str) -> dict:
    """Generate HMAC headers for pipeline API requests."""
    # Serialize body to JSON bytes
    body_bytes = json.dumps(body_dict).encode('utf-8')

    # Current timestamp
    timestamp = str(int(time.time()))

    # Construct message: timestamp + '.' + body
    message = timestamp.encode('utf-8') + b'.' + body_bytes

    # Compute HMAC-SHA256
    mac = hmac.new(
        secret.encode('utf-8'),
        msg=message,
        digestmod=hashlib.sha256
    )

    # Return headers
    return {
        'X-ML-Signature': f'sha256={mac.hexdigest()}',
        'X-ML-Timestamp': timestamp,
        'Content-Type': 'application/json'
    }

# Usage
secret = "your_secret_key"
payload = {"status": "completed"}
headers = generate_hmac_headers(payload, secret)

response = requests.post(
    'http://localhost:8000/api/analyses/{id}/finalize',
    json=payload,
    headers=headers
)
```

#### JavaScript/Node.js Example

```javascript
const crypto = require('crypto');

function generateHmacHeaders(bodyObject, secret) {
    // Serialize body to JSON
    const bodyString = JSON.stringify(bodyObject);
    const bodyBytes = Buffer.from(bodyString, 'utf8');

    // Current timestamp
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // Construct message: timestamp + '.' + body
    const message = Buffer.concat([
        Buffer.from(timestamp + '.', 'utf8'),
        bodyBytes
    ]);

    // Compute HMAC-SHA256
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(message);
    const signature = hmac.digest('hex');

    return {
        'X-ML-Signature': `sha256=${signature}`,
        'X-ML-Timestamp': timestamp,
        'Content-Type': 'application/json'
    };
}

// Usage
const secret = 'your_secret_key';
const payload = {status: 'completed'};
const headers = generateHmacHeaders(payload, secret);

fetch('http://localhost:8000/api/analyses/{id}/finalize', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload)
});
```

### HMAC Verification (Server-Side)

The backend verifies HMAC signatures as follows:

1. Extract `X-ML-Signature` and `X-ML-Timestamp` headers
2. Read raw request body bytes
3. Reconstruct message: `timestamp + '.' + body_bytes`
4. Compute HMAC using configured secret
5. Compare computed signature with provided signature (constant-time comparison)
6. Verify timestamp is within skew window (default: ±300 seconds)

**Security Notes**:
- Keep your HMAC secret secure (use environment variables, never commit to git)
- Use HTTPS in production to protect the secret in transit
- Rotate secrets periodically
- Monitor for failed HMAC attempts (potential attack indicator)

---

## Analysis Lifecycle

### 1. Create Analysis

**Endpoint**: `POST /api/images/{image_id}/analyses`

**Authentication**: User authentication (not HMAC) - typically called by scheduled jobs or admin scripts

**Request**:
```json
{
  "image_id": "550e8400-e29b-41d4-a716-446655440000",
  "model_name": "yolo_v8",
  "model_version": "1.0.0",
  "parameters": {
    "confidence_threshold": 0.5,
    "iou_threshold": 0.4,
    "max_detections": 100
  },
  "provenance": {
    "git_commit": "abc123",
    "podman_image": "myorg/yolo:v8-20250101",
    "training_dataset": "coco2017"
  }
}
```

**Response** (201 Created):
```json
{
  "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "image_id": "550e8400-e29b-41d4-a716-446655440000",
  "model_name": "yolo_v8",
  "model_version": "1.0.0",
  "status": "queued",
  "parameters": {...},
  "provenance": {...},
  "requested_by_id": "...",
  "created_at": "2025-01-15T10:30:00Z",
  "annotations": []
}
```

---

### 2. Update Status to Processing

**Endpoint**: `PATCH /api/analyses/{analysis_id}/status`

**Authentication**: HMAC required

**Request**:
```json
{
  "status": "processing"
}
```

**Python Example**:
```python
payload = {"status": "processing"}
headers = generate_hmac_headers(payload, secret)

response = requests.patch(
    f'{API_BASE_URL}/api/analyses/{analysis_id}/status',
    json=payload,
    headers=headers
)
```

---

### 3. Request Presigned Upload URL

**Endpoint**: `POST /api/analyses/{analysis_id}/artifacts/presign`

**Authentication**: HMAC required

**Request**:
```json
{
  "artifact_type": "heatmap",
  "filename": "attention_map.png"
}
```

**Supported Artifact Types**:
- `heatmap`: Attention/saliency maps (image/png)
- `mask`: Segmentation masks (image/png)
- `segmentation`: Alternative mask format
- `log`: Processing logs (text/plain)
- `metadata`: Additional JSON metadata (application/json)

**Response**:
```json
{
  "upload_url": "https://s3.example.com/ml-outputs/{analysis_id}/attention_map.png?signature=...",
  "storage_path": "ml_outputs/{analysis_id}/attention_map.png"
}
```

**Python Example**:
```python
# Request presigned URL
payload = {"artifact_type": "heatmap", "filename": "heatmap.png"}
headers = generate_hmac_headers(payload, secret)
resp = requests.post(
    f'{API_BASE_URL}/api/analyses/{analysis_id}/artifacts/presign',
    json=payload,
    headers=headers
)
presign_data = resp.json()

# Upload artifact directly to S3
with open('heatmap.png', 'rb') as f:
    requests.put(
        presign_data['upload_url'],
        data=f,
        headers={'Content-Type': 'image/png'}
    )
```

---

### 4. Post Annotations

**Endpoint**: `POST /api/analyses/{analysis_id}/annotations:bulk`

**Authentication**: HMAC required

**Request**:
```json
{
  "annotations": [
    {
      "annotation_type": "bounding_box",
      "class_name": "cat",
      "confidence": 0.95,
      "data": {
        "x_min": 10,
        "y_min": 20,
        "x_max": 150,
        "y_max": 200,
        "image_width": 1024,
        "image_height": 768
      },
      "ordering": 0
    },
    {
      "annotation_type": "classification",
      "class_name": "domestic_cat",
      "confidence": 0.92,
      "data": {
        "topk": [
          {"class": "domestic_cat", "confidence": 0.92},
          {"class": "wild_cat", "confidence": 0.05},
          {"class": "dog", "confidence": 0.02}
        ]
      },
      "ordering": 1
    },
    {
      "annotation_type": "heatmap",
      "data": {
        "width": 512,
        "height": 512,
        "color_map": "viridis"
      },
      "storage_path": "ml_outputs/{analysis_id}/heatmap.png",
      "ordering": 2
    }
  ],
  "mode": "append"
}
```

**Response**:
```json
{
  "annotations": [ ... ],
  "total": 3
}
```

**Limits**:
- Max annotations per request: `ML_MAX_BULK_ANNOTATIONS` (default: 5000)
- Use pagination for larger datasets

---

### 5. Finalize Analysis

**Endpoint**: `POST /api/analyses/{analysis_id}/finalize`

**Authentication**: HMAC required

**Request**:
```json
{
  "status": "completed"
}
```

**Or for failures**:
```json
{
  "status": "failed",
  "error_message": "Out of memory during inference"
}
```

**Response**: Full analysis object with all metadata and timestamps.

**Fast Path**: The finalize endpoint allows direct transition from `queued` → `completed`/`failed` without requiring an intermediate `processing` status update (useful for fast analyses).

---

## Annotation Data Formats

### Bounding Box

```json
{
  "annotation_type": "bounding_box",
  "class_name": "person",
  "confidence": 0.87,
  "data": {
    "x_min": 100,
    "y_min": 50,
    "x_max": 300,
    "y_max": 400,
    "image_width": 1024,
    "image_height": 768
  },
  "ordering": 0
}
```

**Coordinate System**: Top-left origin, pixel coordinates in original image dimensions.

---

### Classification

**Option 1: Top-K Results**
```json
{
  "annotation_type": "classification",
  "class_name": "golden_retriever",
  "confidence": 0.94,
  "data": {
    "topk": [
      {"class": "golden_retriever", "confidence": 0.94},
      {"class": "labrador", "confidence": 0.04},
      {"class": "cocker_spaniel", "confidence": 0.01}
    ]
  }
}
```

**Option 2: Single Class**
```json
{
  "annotation_type": "classification",
  "class_name": "cat",
  "confidence": 0.99,
  "data": {"score": 0.99}
}
```

---

### Heatmap / Attention Map

```json
{
  "annotation_type": "heatmap",
  "data": {
    "width": 512,
    "height": 512,
    "color_map": "viridis"
  },
  "storage_path": "ml_outputs/{analysis_id}/heatmap.png"
}
```

**Requirements**:
- Heatmap must be uploaded via presigned URL before referencing in annotation
- Supported formats: PNG (with transparency/alpha channel recommended)
- Color maps: Metadata only (actual colorization happens in pipeline)

---

### Segmentation Mask

**RLE Format** (COCO-style):
```json
{
  "annotation_type": "segmentation",
  "class_name": "car",
  "confidence": 0.91,
  "data": {
    "format": "rle",
    "counts": "...",
    "bbox": [x, y, width, height],
    "area": 12345
  }
}
```

**Binary Mask Reference**:
```json
{
  "annotation_type": "mask",
  "class_name": "building",
  "data": {
    "width": 1024,
    "height": 768
  },
  "storage_path": "ml_outputs/{analysis_id}/mask.png"
}
```

---

### Keypoints

```json
{
  "annotation_type": "keypoint",
  "class_name": "person",
  "confidence": 0.88,
  "data": {
    "keypoints": [
      {"name": "nose", "x": 150, "y": 100, "confidence": 0.95},
      {"name": "left_eye", "x": 140, "y": 95, "confidence": 0.92},
      {"name": "right_eye", "x": 160, "y": 95, "confidence": 0.90}
    ],
    "skeleton": [[0, 1], [0, 2]]
  }
}
```

---

### Custom / Structured Data

For specialized analysis types, use `custom` annotation type with arbitrary JSON:

```json
{
  "annotation_type": "custom",
  "class_name": "defect_analysis",
  "data": {
    "defect_type": "scratch",
    "severity": "minor",
    "coordinates": [[x1, y1], [x2, y2], [x3, y3]],
    "metadata": {"inspector": "AI-v2"}
  }
}
```

---

## Error Handling & Retries

### Idempotency

Pipeline endpoints support safe retries:
- **Bulk annotations**: Re-posting the same annotations won't create duplicates (handled by database constraints)
- **Status updates**: No-op if already in target status
- **Presigned URLs**: Can be requested multiple times

### Retry Strategy

```python
import time
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry

def requests_retry_session(
    retries=3,
    backoff_factor=0.3,
    status_forcelist=(500, 502, 504),
):
    session = requests.Session()
    retry = Retry(
        total=retries,
        read=retries,
        connect=retries,
        backoff_factor=backoff_factor,
        status_forcelist=status_forcelist,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount('http://', adapter)
    session.mount('https://', adapter)
    return session

# Usage
session = requests_retry_session()
response = session.post(url, json=payload, headers=headers)
```

### Error Codes

| Status Code | Meaning | Action |
|-------------|---------|--------|
| 200 | Success | Continue |
| 201 | Created | Continue |
| 400 | Bad Request | Fix payload, don't retry |
| 401 | Unauthorized | Check HMAC signature |
| 404 | Not Found | Check `analysis_id` or feature flag |
| 409 | Conflict | Illegal state transition, check current status |
| 429 | Rate Limit | Back off exponentially |
| 500 | Server Error | Retry with backoff |

---

## Testing

### Using the Simulation Script

The platform includes a complete pipeline simulation script for testing:

```bash
# 1. Set environment
export ML_CALLBACK_HMAC_SECRET='test_secret_123'
export API_BASE_URL='http://localhost:8000'

# 2. Create a test image (via API or UI)
# Note the image_id

# 3. Run simulation
python scripts/test_ml_pipeline.py --image-id <your_image_id>

# Optional: Specify model
python scripts/test_ml_pipeline.py \
    --image-id <image_id> \
    --model-name custom_model \
    --model-version 2.0.0
```

**What the script does**:
1. Creates an analysis
2. Updates status to processing
3. Requests presigned upload URL
4. Generates and uploads a fake heatmap
5. Posts random bounding boxes, heatmap reference, and classification
6. Finalizes as completed

### Manual Testing with cURL

```bash
SECRET="test_secret_123"
ANALYSIS_ID="your-analysis-id"

# Generate HMAC (requires jq and openssl)
TIMESTAMP=$(date +%s)
BODY='{"status":"completed"}'
MESSAGE="${TIMESTAMP}.${BODY}"
SIGNATURE=$(echo -n "$MESSAGE" | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2)

curl -X POST "http://localhost:8000/api/analyses/${ANALYSIS_ID}/finalize" \
  -H "Content-Type: application/json" \
  -H "X-ML-Timestamp: ${TIMESTAMP}" \
  -H "X-ML-Signature: sha256=${SIGNATURE}" \
  -d "$BODY"
```

---

## Best Practices

### Security

1. **Never hardcode secrets**: Use environment variables or secret managers
2. **Use HTTPS in production**: Protect HMAC secrets in transit
3. **Rotate secrets regularly**: Implement secret rotation strategy
4. **Monitor failed authentications**: Alert on suspicious HMAC failures
5. **Validate inputs**: Check annotation data before sending to API

### Performance

1. **Batch annotations**: Use bulk endpoint instead of individual POSTs
2. **Compress artifacts**: Use PNG compression for heatmaps/masks
3. **Parallel uploads**: Upload artifacts concurrently when possible
4. **Reuse connections**: Use session pooling for HTTP requests
5. **Cache presigned URLs**: They're valid for 15 minutes (default)

### Reliability

1. **Implement retries**: Use exponential backoff for transient errors
2. **Log correlation IDs**: Include `analysis_id` in all logs
3. **Handle partial failures**: Continue processing even if some annotations fail
4. **Set timeouts**: Don't wait indefinitely for API responses
5. **Monitor analysis lifecycle**: Track completion rates and latencies

### Data Quality

1. **Validate coordinates**: Ensure bounding boxes are within image bounds
2. **Normalize confidences**: Keep confidence scores in [0, 1] range
3. **Include provenance**: Document model version, parameters, training data
4. **Version annotations**: Use `ordering` field for consistent rendering
5. **Test with edge cases**: Empty results, large batches, malformed data

---

## Troubleshooting

### Common Issues

**HMAC Authentication Failures**

```
401 Unauthorized: Invalid HMAC signature
```

**Solutions**:
- Verify secret matches backend configuration
- Check timestamp is current (within ±300s)
- Ensure body serialization matches (no extra whitespace, consistent key ordering)
- Use raw request body for signature, not re-serialized model

**Presigned URL Upload Fails**

```
403 Forbidden or SignatureDoesNotMatch
```

**Solutions**:
- Use PUT method, not POST
- Set correct `Content-Type` header
- Don't include authentication headers (presigned URL is self-authenticating)
- Check S3/MinIO credentials and bucket permissions

**Annotations Not Appearing in UI**

**Solutions**:
- Verify analysis status is `completed`
- Check browser console for JavaScript errors
- Inspect annotation data format (must match schema)
- Confirm feature flag `ML_ANALYSIS_ENABLED=true`

---

## Support & Contribution

- **Issues**: [GitHub Issues](https://github.com/your-org/vista/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/vista/discussions)
- **Documentation**: See `ml-plan.md` for implementation status

---

## Appendix: Complete Python Pipeline Example

See `scripts/test_ml_pipeline.py` for a full working example.

For a production pipeline, consider:
- Asynchronous/concurrent processing (asyncio, multiprocessing)
- Job queue integration (Celery, RQ, Kubernetes Jobs)
- Metrics and monitoring (Prometheus, DataDog)
- Graceful shutdown and cleanup
- Configuration management (argparse, environment, config files)

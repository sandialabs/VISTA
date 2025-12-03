# ML Analysis Integration - Implementation Status

This document tracks the implementation status of ML analysis visualization features. The platform orchestrates, stores, and serves ML results without performing model inference internally. External ML pipelines perform computation and push results back via secure APIs.

---

## Guiding Principles
- **Externalized Compute**: This service only orchestrates, stores, and serves results.
- **Additive & Backward Compatible**: All DB changes are additive; existing features remain unaffected.
- **Idempotent & Observable**: External callbacks can be retried safely; every state transition is auditable.
- **Separation of Concerns**: Storage vs. metadata vs. visualization concerns are isolated.
- **Security First**: Strong authentication (API keys / HMAC), provenance, and tamper resistance.

---

## ✅ COMPLETED FEATURES

### Database & Schema (Phase 1)
- ✅ **Database Migration** (`backend/alembic/versions/20250930_0001_initial.py`)
  - `ml_analyses` table with all planned columns (id, image_id, model_name, model_version, status, error_message, parameters, provenance, requested_by_id, external_job_id, priority, timestamps)
  - `ml_annotations` table (id, analysis_id, annotation_type, class_name, confidence, data, storage_path, ordering, created_at)
  - Proper indexes: `idx_ml_analyses_image_id`, `idx_ml_analyses_status`, `idx_ml_analyses_model_name`, `idx_ml_annotations_analysis_id`, `idx_ml_annotations_annotation_type`
  - Unique constraint on `external_job_id` (for deduplication)
  - Cascade delete relationships (deleting analysis deletes annotations)

- ✅ **Models & Schemas** (`backend/core/models.py`, `backend/core/schemas.py`)
  - SQLAlchemy ORM models for `MLAnalysis` and `MLAnnotation`
  - Pydantic schemas: `MLAnalysisCreate`, `MLAnalysis`, `MLAnnotationCreate`, `MLAnnotation`, `MLAnalysisList`, `MLAnnotationList`

- ✅ **CRUD Operations** (`backend/utils/crud.py`)
  - `create_ml_analysis()`, `get_ml_analysis()`, `list_ml_analyses_for_image()`
  - `bulk_insert_ml_annotations()`, `list_ml_annotations()`

### Backend API - User Endpoints (Phase 1)
- ✅ **`POST /api/images/{image_id}/analyses`** (Line 72)
  - Create new ML analysis (queued status)
  - Feature flag check (`ML_ANALYSIS_ENABLED`)
  - Access control via image ownership
  - Model allow-list validation (`ML_ALLOWED_MODELS`)
  - Per-image analysis limit enforcement (`ML_MAX_ANALYSES_PER_IMAGE`)
  - Audit logging

- ✅ **`GET /api/images/{image_id}/analyses`** (Line 122)
  - List all analyses for an image
  - Pagination support (skip/limit)
  - Access control via image ownership
  - Returns lightweight list (annotations excluded for performance)

- ✅ **`GET /api/analyses/{analysis_id}`** (Line 157)
  - Get analysis details with all annotations
  - Access control via image ownership
  - Full annotation data included

- ✅ **`GET /api/analyses/{analysis_id}/annotations`** (Line 203)
  - Paginated annotations endpoint
  - Separate endpoint for large annotation sets
  - Access control via image ownership

- ✅ **`GET /api/ml/artifacts/download`** (Line 18)
  - Generate presigned download URLs for ML artifacts (heatmaps, masks, etc.)
  - Path validation (must start with `ml_outputs/`)
  - Access control via analysis → image ownership
  - Fallback to mock URLs when S3 unavailable

### Backend API - Pipeline Endpoints (Phase 2)
- ✅ **`PATCH /api/analyses/{analysis_id}/status`** (Line 247)
  - Update analysis status with state machine validation
  - Valid transitions: `queued → processing/canceled`, `processing → completed/failed/canceled`
  - Automatic timestamp management (`started_at`, `completed_at`)
  - 409 Conflict on illegal transitions
  - Audit logging

- ✅ **`POST /api/analyses/{analysis_id}/annotations:bulk`** (Line 316)
  - Bulk insert annotations (idempotent)
  - HMAC signature verification
  - Max annotations per request limit (`ML_MAX_BULK_ANNOTATIONS`)
  - Mode support: append (replace/upsert reserved for future)
  - Uses raw request body for HMAC (avoids serialization mismatches)

- ✅ **`POST /api/analyses/{analysis_id}/artifacts/presign`** (Line 366)
  - Generate presigned upload URLs for artifacts
  - HMAC signature verification
  - Content-type mapping (heatmap→image/png, log→text/plain, etc.)
  - Storage path generation: `ml_outputs/{analysis_id}/{filename}`
  - Configurable expiry (`ML_PRESIGNED_URL_EXPIRY_SECONDS`)
  - Fallback to mock URLs when S3 unavailable

- ✅ **`POST /api/analyses/{analysis_id}/finalize`** (Line 426)
  - Finalize analysis (mark completed/failed)
  - HMAC signature verification
  - Fast-path for `queued → completed/failed` (no intermediate processing step required)
  - Automatic timestamp management

### Security (Phase 2)
- ✅ **HMAC Signature Verification** (`backend/utils/dependencies.py`)
  - `verify_hmac_signature_flexible()` helper
  - Headers: `X-ML-Signature` (sha256 hash), `X-ML-Timestamp`
  - Timestamp-based replay protection (configurable skew window)
  - Configured via `ML_CALLBACK_HMAC_SECRET`
  - Optional enforcement via `ML_PIPELINE_REQUIRE_HMAC` flag

- ✅ **Access Control**
  - All user endpoints verify image ownership via `get_image_or_403()`
  - Pipeline endpoints verify HMAC + image ownership

### Frontend - Core UI (Phase 3)
- ✅ **`MLAnalysisPanel` Component** (`frontend/src/components/MLAnalysisPanel.js`)
  - Lists all analyses for an image
  - Status badges with color coding (queued=gray, processing=blue, completed=green, failed=red, canceled=gray)
  - Click to select analysis and load annotations
  - Auto-polling every 8 seconds when non-terminal analyses exist
  - Read-only interface (no user-triggered analysis creation)
  - Gracefully handles empty state (hides when no analyses)
  - Annotation detail view with type, class, confidence display

- ✅ **Integration into ImageView** (`frontend/src/ImageView.js`)
  - Panel added to sidebar (line 338)
  - State management for selected analysis and annotations
  - Passes overlay options to ImageDisplay component

- ✅ **`BoundingBoxOverlay` Component** (`frontend/src/components/BoundingBoxOverlay.js`)
  - Renders bounding boxes from annotations
  - Coordinate scaling from natural image size to display size
  - Orange boxes with semi-transparent fill
  - Class name and confidence labels
  - Supports multiple coordinate formats (x_min/y_min/x_max/y_max or left/top/right/bottom)
  - Memoized for performance

- ✅ **`HeatmapOverlay` Component** (`frontend/src/components/HeatmapOverlay.js`)
  - Renders heatmap/segmentation/mask images from `storage_path`
  - Lazy-loads via presigned download URLs from backend
  - Error handling and loading states
  - Supports all bitmap annotation types (heatmap, segmentation, mask)
  - Scales to container size with `object-fit: contain`

- ✅ **`OverlayControls` Component** (`frontend/src/components/OverlayControls.js`)
  - Toggle bounding boxes on/off
  - Toggle heatmap on/off (only when bitmap annotations available)
  - Opacity slider (10%-100%)
  - View mode selector: Overlay or Side-by-Side
  - Clean, compact UI in sidebar

- ✅ **ImageDisplay Integration** (`frontend/src/components/ImageDisplay.js`)
  - Overlay mode: Overlays rendered on top of image (line 258-272)
  - Side-by-side mode: Original vs. ML overlay in split view (line 279-289)
  - Passes display size, natural size, and overlay options to overlay components
  - Coordinate scaling and resize handling

### Configuration
- ✅ **Environment Variables** (`backend/core/config.py`)
  - `ML_ANALYSIS_ENABLED` - Feature flag
  - `ML_CALLBACK_HMAC_SECRET` - HMAC signing secret
  - `ML_PIPELINE_REQUIRE_HMAC` - Enforce HMAC on pipeline endpoints
  - `ML_ALLOWED_MODELS` - Comma-separated model whitelist
  - `ML_MAX_ANALYSES_PER_IMAGE` - Per-image limit
  - `ML_MAX_BULK_ANNOTATIONS` - Bulk insert limit
  - `ML_PRESIGNED_URL_EXPIRY_SECONDS` - URL expiry time
  - `ML_DEFAULT_STATUS` - Default status for new analyses

---

## 📋 SHORT-TERM TODO (High Priority)

### Export Functionality
- ❌ **Backend: Export Analysis Endpoint**
  - `GET /api/analyses/{analysis_id}/export` - Export full analysis as JSON
  - Include: analysis metadata, all annotations, artifact references, provenance
  - Optional formats: JSON (default), CSV (annotations only)
  - Implement in `backend/routers/ml_analyses.py`

- ❌ **Frontend: Export UI**
  - Add "Export" button to MLAnalysisPanel for selected analysis
  - Download as `analysis_{model_name}_{timestamp}.json`
  - Implement in `frontend/src/components/MLAnalysisPanel.js`

### Testing
- ❌ **Backend API Tests** (`backend/tests/test_ml_analyses.py`)
  - Test analysis CRUD operations
  - Test state machine transitions (valid and invalid)
  - Test bulk annotation upload
  - Test presigned URL generation
  - Test access control (user cannot access other user's analyses)
  - Test pagination
  - Test feature flag enforcement
  - Test model allow-list validation
  - Test per-image limits

- ❌ **HMAC Security Tests** (`backend/tests/test_ml_security.py`)
  - Test vectors for HMAC signature generation
  - Test signature verification (valid signature passes)
  - Test invalid signature rejection
  - Test missing signature rejection (when required)
  - Test timestamp replay protection (old timestamps rejected)
  - Test timestamp skew tolerance

- ❌ **Pipeline Simulation Script** (`scripts/test_ml_pipeline.py`)
  - Mock pipeline that:
    1. Creates a test analysis
    2. Updates status to processing
    3. Requests presigned upload URL
    4. Uploads a fake heatmap image
    5. Posts bulk annotations (bounding boxes + heatmap reference)
    6. Finalizes analysis as completed
  - Use for manual testing and demonstration
  - Include HMAC signature generation
  - Configurable via environment variables

- ❌ **Frontend Component Tests**
  - Unit tests for MLAnalysisPanel (rendering, polling, selection)
  - Unit tests for overlay components (coordinate scaling, rendering)
  - Snapshot tests for overlay rendering

### Documentation
- ❌ **README.md Updates**
  - Add "ML Analysis" section explaining:
    - Feature overview (external pipeline, read-only UI)
    - How to enable the feature (`ML_ANALYSIS_ENABLED=true`)
    - User workflow (view analyses, select, toggle overlays)
    - Link to developer guide for pipeline integration

- ❌ **Developer Guide** (`docs/ML_PIPELINE_INTEGRATION.md`)
  - How to integrate an external ML pipeline:
    1. Environment setup (HMAC secret, allowed models)
    2. API authentication (HMAC signature generation examples in Python/JavaScript)
    3. Analysis lifecycle walkthrough with code examples
    4. Artifact upload workflow
    5. Annotation data format specifications
    6. Error handling and retry strategies
    7. Testing with mock pipeline script
  - Include code examples for:
    - HMAC signature generation
    - Creating an analysis
    - Uploading artifacts
    - Posting annotations
    - Finalizing analysis

- ❌ **API Documentation**
  - Add ML analysis endpoints to Swagger/OpenAPI docs
  - Document request/response schemas
  - Document HMAC authentication requirements
  - Document annotation data JSON schemas by type

### HMAC Security Hardening
- ❌ **Nonce-Based Replay Protection**
  - Add optional `X-ML-Nonce` header
  - Store used nonces in Redis/in-memory cache with TTL
  - Reject duplicate nonces within time window
  - Implement in `backend/utils/dependencies.py`

- ❌ **API Key System for Pipelines** (Optional, currently using HMAC only)
  - Create pipeline-specific API keys (prefix: `mlpip_`)
  - Store hashed keys in database
  - Scope keys to ML analysis endpoints only
  - Add `X-API-Key` header authentication
  - Log key usage for audit trail

---

## 🔮 LONG-TERM TODO (Lower Priority)

### Phase 2 - Pipeline Integration (Remaining)
- ⏸️ **Job Claiming Endpoint** (Optional)
  - `POST /api/analyses/{analysis_id}/claim` - Atomic claim of queued analysis
  - Prevents duplicate processing by multiple workers
  - Returns 409 if already claimed
  - Useful for pull-based pipelines

- ⏸️ **Rate Limiting**
  - Per-IP rate limiting for pipeline endpoints
  - Per-API-key rate limiting (if API keys implemented)
  - Sliding window algorithm
  - Configurable limits via environment variables

- ⏸️ **Pipeline Worker RBAC Role**
  - Define `pipeline_worker` role
  - Restrict to ML analysis endpoints only
  - Cannot access user data, projects, images directly
  - Implement in `backend/utils/auth.py`

### Phase 3 - Frontend (Remaining)
- ⏸️ **Additional Annotation Type Renderers**
  - Keypoint overlay (dots with connecting lines)
  - Polygon overlay (closed shapes)
  - Segmentation mask overlay (RLE decode + canvas)
  - Classification overlay (badge/label display)

- ⏸️ **WebSocket Real-Time Updates**
  - Replace polling with WebSocket for status updates
  - Push notifications when analysis completes
  - Reduces server load and improves UX

- ⏸️ **Client-Side Caching**
  - In-memory Map cache for analysis data
  - Keyed by `analysis_id`
  - Cache presigned URLs (with expiry awareness)
  - Reduce redundant API calls

- ⏸️ **Analysis Comparison View**
  - Compare multiple analyses side-by-side
  - Diff annotations between models
  - Toggle between different model outputs

### Phase 4 - Observability & Advanced Features
- ⏸️ **Metrics & SLO Tracking**
  - Status transition time metrics (`completed_at - started_at`)
  - Analysis success/failure rates
  - Annotation count distributions
  - Prometheus/OpenTelemetry integration

- ⏸️ **Distributed Tracing**
  - Span wrappers around status transitions
  - Correlation IDs across pipeline and service
  - OpenTelemetry integration

- ⏸️ **Provenance Export**
  - Export full provenance bundle (metadata + annotations + artifacts)
  - Manifest format for reproducibility
  - Include git commit, model SHA, container image, parameters

- ⏸️ **Batch Analysis Management**
  - `analysis_group_id` for related analyses
  - Batch operations (cancel all, export all)
  - Bulk status view

- ⏸️ **Advanced Query/Filter UI**
  - Filter analyses by status, model, date range
  - Search annotations by class name
  - Sort by confidence, date, model

- ⏸️ **Orphaned Analysis Cleanup**
  - Background job to mark stale analyses (stuck in queued/processing)
  - Configurable TTL
  - Automatic retry or cancellation

- ⏸️ **Soft Deletion of Analyses**
  - Add `deleted_at` column to `ml_analyses`
  - UI to delete unwanted analyses
  - Retention policy

### Configuration (Remaining)
- ⏸️ **Additional Environment Variables**
  - `ML_PIPELINE_PULL_ENABLED` - Enable job polling by external workers
  - `ML_PIPELINE_PUSH_WEBHOOKS_ENABLED` - Enable webhook push to pipeline
  - `ML_MAX_PENDING_PER_USER` - Per-user pending analysis limit
  - `ML_WEBHOOK_URL` - Pipeline webhook endpoint (if push enabled)

---

## 📊 Data Model Reference

### `ml_analyses` Table
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | Internal identifier |
| `image_id` | FK → `data_instances.id` | Target image (indexed, cascade delete) |
| `model_name` | text | e.g. `yolo_v8`, `resnet50_classifier` |
| `model_version` | text | Semantic version or git hash |
| `status` | text | `queued`, `processing`, `completed`, `failed`, `canceled` |
| `error_message` | text (nullable) | Failure reason |
| `parameters` | JSONB (nullable) | Hyperparameters / thresholds |
| `provenance` | JSONB (nullable) | Source info: commit SHA, container tag, environment |
| `requested_by_id` | FK → `users.id` | User who initiated |
| `external_job_id` | text (nullable) | External system correlation (unique) |
| `priority` | integer | Scheduling preference (default: 0) |
| `created_at` | timestamptz | Creation time |
| `started_at` | timestamptz (nullable) | Processing start |
| `completed_at` | timestamptz (nullable) | Completion time |
| `updated_at` | timestamptz (nullable) | Last modification |

### `ml_annotations` Table
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | Internal identifier |
| `analysis_id` | FK → `ml_analyses.id` | Parent analysis (indexed, cascade delete) |
| `annotation_type` | text | `classification`, `bounding_box`, `heatmap`, `segmentation`, `polygon`, `keypoint`, `custom` |
| `class_name` | text (nullable) | Class label |
| `confidence` | numeric(5,4) (nullable) | 0–1 range |
| `data` | JSONB | Type-specific structured data |
| `storage_path` | text (nullable) | Object storage key for large artifacts |
| `ordering` | integer (nullable) | Sequence or ranking |
| `created_at` | timestamptz | Creation time |

### Annotation `data` JSON Formats

#### Bounding Box
```json
{
  "x_min": 12,
  "y_min": 33,
  "x_max": 240,
  "y_max": 300,
  "image_width": 1024,
  "image_height": 768
}
```

#### Classification
```json
{
  "topk": [
    {"class": "cat", "confidence": 0.91},
    {"class": "dog", "confidence": 0.07}
  ]
}
```

#### Heatmap Reference
```json
{
  "width": 512,
  "height": 512,
  "color_map": "viridis"
}
```
*Note: Binary PNG stored at `storage_path`*

#### Segmentation (RLE)
```json
{
  "format": "rle",
  "counts": "...",
  "bbox": [x, y, w, h],
  "area": 12345
}
```

---

## 🔐 Security Model

### HMAC Authentication
- **Algorithm**: `HMAC-SHA256`
- **Secret**: `ML_CALLBACK_HMAC_SECRET` environment variable
- **Signature Format**: `sha256={hex_digest}`
- **Headers**:
  - `X-ML-Signature`: HMAC signature
  - `X-ML-Timestamp`: Unix timestamp (seconds)
- **Replay Protection**: Reject requests with `|now - timestamp| > 300s`
- **Enforcement**: Controlled by `ML_PIPELINE_REQUIRE_HMAC` flag

### Access Control
- **User Endpoints**: Require image ownership (via `get_image_or_403`)
- **Pipeline Endpoints**: Require HMAC signature + image ownership verification
- **Feature Flag**: All endpoints check `ML_ANALYSIS_ENABLED`

### Future Enhancements
- Pipeline-specific API keys (prefix: `mlpip_`)
- RBAC role: `pipeline_worker` (restricted permissions)
- Nonce-based replay protection
- Rate limiting per key/IP

---

## 🔄 Status State Machine

```
queued ─────┬──→ processing ─────┬──→ completed
            │                    │
            │                    ├──→ failed
            │                    │
            │                    └──→ canceled
            │
            └──────────────────────→ canceled
```

**Valid Transitions**:
- `queued` → `processing`, `canceled`
- `processing` → `completed`, `failed`, `canceled`

**Illegal Transitions**: Return `409 Conflict`

---

## 📦 Storage Layout

```
ml_outputs/
  {analysis_id}/
    heatmap.png
    mask.png
    metadata.json
```

---

## 🚀 Quick Start Guide

### For End Users
1. Navigate to an image in the UI
2. If ML analyses exist, the "ML Analyses" panel appears in the sidebar
3. Click an analysis to view annotations
4. Use "Overlays" controls to toggle bounding boxes/heatmaps
5. Adjust opacity slider or switch to side-by-side view

### For Pipeline Developers
1. Set `ML_ANALYSIS_ENABLED=true` and `ML_CALLBACK_HMAC_SECRET=<secret>`
2. Add allowed models: `ML_ALLOWED_MODELS=yolo_v8,resnet50`
3. Create analysis: `POST /api/images/{id}/analyses`
4. Update status: `PATCH /api/analyses/{id}/status`
5. Request upload URL: `POST /api/analyses/{id}/artifacts/presign`
6. Upload artifact to presigned URL
7. Post annotations: `POST /api/analyses/{id}/annotations:bulk`
8. Finalize: `POST /api/analyses/{id}/finalize`

See `docs/ML_PIPELINE_INTEGRATION.md` for detailed examples (TODO).

---

## 📝 Notes

- **No user-triggered analysis creation**: All analyses are created by external systems (cron jobs, webhooks, ML pipelines)
- **Idempotent operations**: All pipeline endpoints support safe retries
- **Graceful degradation**: UI hides when no analyses exist; feature flag disables all endpoints cleanly
- **S3 fallback**: Mock URLs returned when S3 unavailable (for development)

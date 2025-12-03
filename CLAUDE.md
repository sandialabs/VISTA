# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VISTA is a full-stack application for image management, classification, and collaboration. The platform allows teams to organize visual content into projects, apply custom labels, add comments, and visualize machine learning analysis results.

**Stack:**
- **Backend:** FastAPI (Python 3.11+) with async SQLAlchemy
- **Frontend:** React 18 with React Router
- **Database:** PostgreSQL 15 (with Alembic migrations)
- **Storage:** MinIO/S3 for object storage
- **Package Management:** `uv` for Python, `npm` for JavaScript

## Code Style Guidelines

**IMPORTANT: NO EMOJIS** - Never use emojis in code, comments, commit messages, documentation, or any output. This codebase maintains a professional, emoji-free style.

## Development Setup Commands

### Initial Setup

```bash
# Start infrastructure (Postgres & MinIO)
podman compose up -d postgres minio

# Backend setup
pip install uv
uv venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt

# Run database migrations (REQUIRED - migrations are manual)
cd backend
alembic upgrade head

# Start backend
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# OR use the backend run script
cd backend
./run.sh

# Frontend setup (in separate terminal)
cd frontend
npm install
npm run dev
```

### Running Tests

**Unified Test Runner** (recommended):
```bash
# Run both backend and frontend tests (from project root)
./test/run_tests.sh

# Run only backend or frontend
./test/run_tests.sh --backend
./test/run_tests.sh --frontend

# Verbose output for debugging
./test/run_tests.sh --verbose
```

**Test Script Output Philosophy:**
- Default output is minimal: shows only pass/fail status for each test suite
- Suppresses verbose tool output, dependency installation messages, and framework noise
- Clear, concise results that make it immediately obvious if tests are working
- Use `--verbose` flag when you need detailed output for debugging
- Follows the "no emojis" rule - professional output only

**Direct Test Commands:**

Backend tests (run from project root):
```bash
source .venv/bin/activate
cd backend
pytest
pytest tests/test_specific_file.py              # Single test file
pytest tests/test_file.py::test_function_name   # Single test
pytest -v                                       # Verbose output
pytest -k "test_auth"                           # Run tests matching pattern
```

Frontend tests use Jest via `react-scripts`:
```bash
cd frontend
npm test                    # Interactive mode
npm test -- --coverage      # With coverage
```

### Building

```bash
# Frontend production build
cd frontend
npm run build

# Docker image
podman build -t vista .
```

## Architecture Overview

### Backend Structure

The FastAPI backend follows a modular architecture:

- **`main.py`**: Application factory, middleware stack, lifespan management, and routing setup
- **`core/`**: Core application components
  - `models.py`: SQLAlchemy ORM models (User, Project, DataInstance, ImageClass, etc.)
  - `schemas.py`: Pydantic models for request/response validation
  - `database.py`: Async database engine and session management
  - `config.py`: Centralized settings using Pydantic BaseSettings
  - `security.py`: Authentication and authorization utilities
  - `group_auth.py` / `group_auth_helper.py`: Group-based authorization system
- **`routers/`**: API endpoint definitions organized by resource (projects, images, users, comments, image_classes, ml_analyses, etc.)
- **`middleware/`**: Request/response processing
  - `auth.py`: Unified authentication middleware (header-based auth)
  - `cors_debug.py`: CORS configuration
  - `security_headers.py`: Security headers (CSP, X-Frame-Options, etc.)
  - `body_cache.py`: Request body caching for HMAC verification
- **`utils/`**: Shared utilities
  - `crud.py`: Database CRUD operations
  - `dependencies.py`: FastAPI dependency injection helpers
  - `boto3_client.py`: S3/MinIO client initialization
  - `cache_manager.py`: Caching layer for performance optimization
  - `file_security.py`: File type validation
- **`alembic/`**: Database migration management
  - `versions/`: Migration scripts
  - `env.py`: Alembic environment configuration

### Database Models

Key models and their relationships:

- **User**: Application users (referenced by email or UUID)
- **Project**: Top-level organization unit with group-based access control (`meta_group_id`)
- **DataInstance** (images): Belongs to a project, stores file metadata and S3 keys
  - Supports soft deletion (with `deleted_at`, `deletion_reason`)
  - Hard deletion tracking (`hard_deleted_at`, `storage_deleted`)
- **ImageClass**: Custom labels/categories per project
- **ImageClassification**: Links images to classes (created by users)
- **ImageComment**: User comments on images
- **MLAnalysis**: Machine learning analysis metadata
  - **MLAnnotation**: Individual annotations (bounding boxes, heatmaps, etc.)
  - **MLArtifact**: Binary outputs stored in S3 (visualizations, processed images)
- **ProjectMetadata**: Key-value metadata for projects
- **ApiKey**: API key authentication for programmatic access

### Frontend Structure

React application with component-based architecture:

- **`src/App.js`**: Main application component with routing
- **`src/Project.js`**: Project detail view
- **`src/ImageView.js`**: Individual image viewer
- **`src/ApiKeys.js`**: API key management interface
- **`src/components/`**: Reusable UI components
  - `ImageGallery.js`: Grid view of images with pagination
  - `ImageDisplay.js`: Main image display with ML overlays
  - `ImageClassifications.js`: Classification management
  - `ImageComments.js`: Comment threads
  - `ImageMetadata.js`: Metadata viewer/editor
  - `MLAnalysisPanel.js`: ML analysis selection and controls
  - `BoundingBoxOverlay.js` / `HeatmapOverlay.js`: ML visualization overlays
  - `ClassManager.js`: Project-level class management
  - `MetadataManager.js`: Project metadata editor
  - `ImageDeletionControls.js`: Soft/hard deletion UI

### Authentication & Authorization

The application uses **header-based authentication** via reverse proxy:

- **Development/Testing Mode**: Mock user from `MOCK_USER_EMAIL` and `MOCK_USER_GROUPS_JSON` environment variables
- **Production Mode**: Validates `X-User-Email` header and `X-Proxy-Secret` against `PROXY_SHARED_SECRET`
- **Group-Based Access**: Projects belong to groups (`meta_group_id`), users must be members to access
- **API Keys**: Alternative authentication via `ApiKey` model for programmatic access

Authentication is enforced by `middleware/auth.py` which sets `request.state.user_email`.

### Caching Strategy

The application implements multi-layer caching for performance:

- **Image list caching**: Cached per user/project with pagination parameters
- **Thumbnail caching**: Disk cache for resized images
- **Metadata caching**: Project and image metadata
- Cache invalidation on mutations (create/update/delete operations)
- Uses `aiocache` and `diskcache` libraries

### Database Migrations (Alembic)

**CRITICAL**: Migrations are **NOT** automatic. They must be run manually:

```bash
# Apply all pending migrations
cd backend
alembic upgrade head

# Create new migration after model changes
alembic revision --autogenerate -m "describe change"

# Rollback last migration
alembic downgrade -1

# View migration history
alembic history --verbose
```

**Key Points:**
- Migrations are enabled by default (`USE_ALEMBIC_MIGRATIONS=true`)
- Migration files are in `backend/alembic/versions/`
- Always review autogenerated migrations before committing
- For new databases, run `alembic upgrade head` to create schema
- For existing databases migrated to Alembic, use `alembic stamp <revision>` to mark current state

See README.md "Database Migrations" section for complete details.

## ML Analysis Feature

External ML pipelines integrate via REST API (users cannot trigger analyses directly):

1. **Create analysis** (`POST /api/images/{image_id}/analyses`)
2. **Update status** to `processing` (`PATCH /api/analyses/{analysis_id}/status`)
3. **Request presigned URLs** for artifact uploads (`POST /api/analyses/{analysis_id}/artifacts/presign`)
4. **Upload artifacts** to S3 via presigned URLs
5. **Bulk create annotations** (`POST /api/analyses/{analysis_id}/annotations:bulk`)
6. **Finalize analysis** with `completed` status

**Security:** Pipeline endpoints (steps 2-6) require HMAC authentication:
- `X-ML-Signature`: HMAC-SHA256(request_body, ML_CALLBACK_HMAC_SECRET)
- `X-ML-Timestamp`: Unix timestamp (prevents replay attacks)

Configuration:
- `ML_ANALYSIS_ENABLED=true` to enable feature
- `ML_CALLBACK_HMAC_SECRET`: Shared secret for HMAC validation
- `ML_ALLOWED_MODELS`: Comma-separated list of permitted model names

Test script: `scripts/test_ml_pipeline.py`

## Environment Configuration

Copy `.env.example` to `.env` and configure:

**Critical Settings:**
- `DATABASE_URL`: PostgreSQL connection string (default: `postgresql+asyncpg://postgres:postgres@localhost:5433/postgres`)
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`: Object storage configuration
- `DEBUG`: Set to `true` for development (skips frontend static file serving)
- `PROXY_SHARED_SECRET`: Production authentication shared secret
- `ML_CALLBACK_HMAC_SECRET`: ML pipeline authentication secret

## Common Development Patterns

### Adding a New API Endpoint

1. Define Pydantic schemas in `core/schemas.py`
2. Create CRUD functions in `utils/crud.py` if needed
3. Add router in `routers/<resource>.py`
4. Include router in `main.py` (in the `api_router` setup)
5. Add tests in `backend/tests/test_<resource>.py`

### Adding a Database Model

1. Add SQLAlchemy model in `core/models.py`
2. Create migration: `cd backend && alembic revision --autogenerate -m "add model"`
3. Review migration file in `alembic/versions/`
4. Apply migration: `alembic upgrade head`
5. Add corresponding Pydantic schemas in `core/schemas.py`

### Working with S3/MinIO

- Use `utils/boto3_client.py` for S3 operations
- Presigned URLs are preferred for direct client uploads/downloads
- Object keys follow pattern: `projects/{project_id}/{filename}` or `ml_outputs/{analysis_id}/{artifact_name}`

### Cache Invalidation

When modifying data, invalidate relevant cache entries:
```python
from aiocache import Cache

cache = Cache()
await cache.delete(f"projects:user:{user_email}:skip:0:limit:100")
```

Common cache key patterns are in the respective router files.

## Testing Considerations

- Tests use SQLite (`sqlite+aiosqlite:///./test.db`) for speed
- Set `FAST_TEST_MODE=true` to skip external dependencies
- Mock S3 operations in tests using `unittest.mock`
- Authentication is bypassed in tests via `SKIP_HEADER_CHECK=true`

## Production Deployment

### Reverse Proxy Setup

Production deployments require a reverse proxy (nginx, Apache) for authentication. The application uses header-based authentication:

- **Documentation:** `docs/production/proxy-setup.md` - Complete setup guide
- **Nginx Example:** `docs/production/nginx-example.conf` - Production-ready configuration

Key requirements:
- Reverse proxy authenticates users (OAuth2, SAML, LDAP, etc.)
- Sets `X-User-Id` header with authenticated user's email
- Sets `X-Proxy-Secret` header with shared secret (configured via `PROXY_SHARED_SECRET`)
- Backend validates both headers before processing requests

### Docker Deployment

Single container deployment via `Dockerfile`:
- Multi-stage build (Node for frontend, Python for backend)
- Serves both frontend static files and backend API
- Requires external PostgreSQL and MinIO/S3
- See `deployment-test/` for Kubernetes manifests

### Production Checklist

- Set `DEBUG=false` and `SKIP_HEADER_CHECK=false`
- Generate and configure `PROXY_SHARED_SECRET` (use `openssl rand -hex 32`)
- Configure reverse proxy with authentication (see `docs/production/`)
- Implement custom `_check_group_membership` in `core/group_auth.py`
- Configure firewall rules to restrict backend access to proxy only
- Run migrations: `alembic upgrade head`
- Configure production database and S3/MinIO
- Set up SSL/TLS certificates
- Enable monitoring and logging

## Security Notes

- All file uploads validated by `utils/file_security.py`
- Security headers configured via `middleware/security_headers.py`
- CORS strictly configured in `middleware/cors_debug.py`
- Group-based authorization prevents cross-project access
- Soft deletion prevents accidental data loss (60-day retention by default)
- Header-based authentication with shared secret validation
- Backend should only accept connections from trusted reverse proxy


# style

* no emojis ever.
* each file less than 400 lines of code.
* test scripts and utilities: minimal output by default, verbose mode optional
  - Show only essential pass/fail information
  - Suppress dependency installation and framework noise
  - Make it immediately obvious if things are working
  - Provide --verbose flag for debugging when needed 




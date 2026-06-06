# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VISTA is a full-stack application for image management, classification, and collaboration. The platform allows teams to organize visual content into projects, apply custom labels, add comments, and visualize machine learning analysis results.

**Stack:**
- **Backend:** FastAPI (Python 3.11+) with async SQLAlchemy
- **Frontend:** React 18 with React Router
- **Database:** PostgreSQL 15 (with Alembic migrations)
- **Storage:** MinIO/S3 for object storage
- **Package Management:** `uv` for Python (via `pyproject.toml` + `uv.lock`), `npm` for JavaScript

## Code Style Guidelines

**IMPORTANT: NO EMOJIS** - Never use emojis in code, comments, commit messages, documentation, or any output. This codebase maintains a professional, emoji-free style.

## Development Setup Commands

### Initial Setup

```bash
# Start infrastructure (Postgres & MinIO)
podman compose up -d postgres minio

# Backend setup
pip install uv
uv sync

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
cd backend
uv run pytest
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
  - `group_auth.py` / `group_auth_helper.py`: Group-based authorization system
- **`routers/`**: API endpoint definitions organized by resource (projects, images, users, comments, image_classes, ml_analyses, reviews, export, etc.)
- **`middleware/`**: Request/response processing
  - `cors_debug.py`: CORS configuration
  - `security_headers.py`: Security headers (CSP, X-Frame-Options, etc.)
- **`utils/`**: Shared utilities
  - `crud.py`: Database CRUD operations
  - `dependencies.py`: FastAPI dependency injection and authentication (`get_current_user`, `require_proxy_user`)
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
- **ImageReview**: Review verification records for images (statuses: pass, reject_pending, reject_confirmed)
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
  - `ReviewPanel.js`: Review verification panel (pass/reject/confirm)
  - `ReviewStatusBadge.js`: Review status badge for gallery thumbnails
  - `ReviewStatusSummary.js`: Project-level review progress bar
  - `ImageMetadata.js`: Metadata viewer/editor
  - `MLAnalysisPanel.js`: ML analysis selection and controls
  - `BoundingBoxOverlay.js` / `HeatmapOverlay.js`: ML visualization overlays
  - `ClassManager.js`: Project-level class management
  - `MetadataManager.js`: Project metadata editor
  - `ImageDeletionControls.js`: Soft/hard deletion UI
  - `FilenameMetadataExtractor.js`: Extracts key-value metadata from filenames during upload (simple delimiter or regex mode)
  - `ImageUploader.js`: File upload with drag-and-drop, metadata entry, and filename metadata extraction

### Authentication & Authorization

All endpoints live under a single `/api` prefix. Authentication is handled by the `get_current_user` FastAPI dependency (in `utils/dependencies.py`), which resolves the caller from one of two sources:

1. **Bearer token (API key)**: `Authorization: Bearer <key>` -- resolved against hashed keys in the database. Used by scripts, automation, and ML pipelines.
2. **Proxy headers**: `X-User-Email` + `X-Proxy-Secret` -- set by a reverse proxy that authenticates users (OAuth2, SAML, etc.). Used by the web UI.

In debug/test mode (`DEBUG=true` or `SKIP_HEADER_CHECK=true`), the dependency falls back to `MOCK_USER_EMAIL`.

**Privilege boundary:** Sensitive endpoints (API key management in `api_keys.py`, user admin in `users.py`) use `require_proxy_user` instead of `get_current_user`. This dependency rejects API key auth, preventing API keys from creating new API keys or managing users.

- **Group-Based Access**: Projects belong to groups (`meta_group_id`), users must be members to access
- **API Keys**: Alternative authentication via `ApiKey` model for programmatic access

**Group-auth backend (fail-closed).** `core/group_auth.py:_check_group_membership` raises `NotImplementedError` by default. Integrators MUST set `VISTA_AUTH_BACKEND`:

- `demo` -- hardcoded example email/group mapping. Development and tests only; refused when `ENV=production`.
- `custom` -- integrator has replaced `_check_group_membership` with a real auth-system lookup.

Startup calls `run_auth_startup_self_test()` and `settings.validate_production_safety()`. Startup fails if: `VISTA_AUTH_BACKEND` is unset or unknown; `ENV=production` with `DEBUG=true`, `SKIP_HEADER_CHECK=true`, `VISTA_AUTH_BACKEND=demo`, or missing `PROXY_SHARED_SECRET`; or a non-demo backend still grants any of the hardcoded demo emails (`admin@example.com`, `scientist@example.com`, `user@example.com`) access to the demo groups.

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

**Security:** All pipeline endpoints use standard `get_current_user` authentication (API key via `Authorization: Bearer <key>` or proxy headers).

Configuration:
- `ML_ANALYSIS_ENABLED=true` to enable feature
- `ML_ALLOWED_MODELS`: Comma-separated list of permitted model names

Test script: `scripts/test_ml_pipeline.py`

## Review Verification Workflow

Images can be reviewed through a four-status workflow that tracks inspection decisions:

**Statuses:**
- `unreviewed` -- default, no review recorded yet
- `pass` -- inspector approved the image
- `reject_pending` -- inspector rejected, awaiting senior confirmation
- `reject_confirmed` -- rejection confirmed by senior reviewer

**API Endpoints:**
- `POST /api/images/{image_id}/reviews` -- create a review (pass/reject_pending/reject_confirmed)
- `GET /api/images/{image_id}/reviews` -- get review history for an image
- `GET /api/images/{image_id}/review-status` -- get current review status summary
- `DELETE /api/reviews/{review_id}` -- revoke/delete a review
- `GET /api/projects/{project_id}/review-status` -- aggregate project review stats
- `GET /api/projects/{project_id}/image-review-statuses` -- bulk status map for all images

**Frontend Components:**
- `ReviewPanel` in image viewer sidebar: pass/reject buttons, secondary review checkbox, history
- `ReviewStatusBadge` on gallery thumbnails: color-coded status indicators
- `ReviewStatusSummary` on project page: progress bar and aggregate counts
- Gallery filter dropdown to filter by review status

**Database:** `image_reviews` table with `id`, `image_id`, `project_id`, `reviewer_id`, `status`, `notes`, `created_at`, `updated_at`. Migration: `20260220_0003_add_image_reviews.py`.

## Excel Export Feature

The export endpoint (`GET /api/projects/{project_id}/export-excel`) generates an Excel (.xlsx) file with one row per non-deleted image. Requires `openpyxl`.

**Columns (dynamic):** Filename (always first), one column per unique metadata key found across all project images (in order of first appearance), Review Status / Reviewer / Review Date (most recent review for the image), Image Classes, Comment. No columns are hardcoded -- the sheet structure adapts to whatever metadata users store on their images.

**Key implementation details:**
- Backend: `routers/export.py` -- uses bulk IN-clause queries to avoid N+1; metadata keys are collected dynamically from `metadata_json` and passed to `_build_workbook(project_name, rows, meta_keys)`
- Frontend: `src/utils/downloadExcel.js` -- shared download utility used by both `Project.js` and `ProjectReport.js`
- Tests: `tests/test_export.py` -- integration and unit tests for the endpoint and `_build_workbook`

## Image Grouping Feature

Images within a project can be organized into named groups (by part number, serial number, specimen ID, etc.) using the `image_groups` table.

**Database:** `image_groups` table with `id`, `project_id`, `identifier`, `display_name`, `created_at`, `updated_at`. Unique constraint on `(project_id, identifier)`. `data_instances` has a nullable `group_id` FK. Migration: `20260306_0004_add_image_groups.py`.

**API Endpoints:**
- `GET /api/projects/{project_id}/groups` -- list groups (paginated, searchable, with image counts and aggregate review status)
- `POST /api/projects/{project_id}/groups` -- create a group
- `GET /api/projects/{project_id}/has-groups` -- check if project has any groups
- `GET /api/groups/{group_id}` -- get group detail
- `PATCH /api/groups/{group_id}` -- update group
- `DELETE /api/groups/{group_id}` -- delete group (optionally soft-deletes images via `?delete_images=true`)
- `POST /api/groups/{group_id}/images` -- assign images to group (body: list of image IDs)
- `DELETE /api/groups/{group_id}/images` -- remove images from group
- `GET /api/projects/{project_id}/images?group_id=...` -- filter images by group
- `GET /api/projects/{project_id}/images?ungrouped=true` -- filter to ungrouped images
- `POST /api/projects/{project_id}/images` -- accepts optional `group_identifier` form field (find-or-create)

**Frontend Components:**
- `GroupedImagesPage.js` -- shown in `Project.js` when the project has groups; list view with group name, image count, and aggregate review status badge
- `GroupGalleryView.js` -- gallery page filtered to a single group or all ungrouped images
- `ImageGroupPanel.js` -- sidebar panel in `ImageView.js` for viewing/changing group assignment
- Routes: `/project/:id/group/:groupId` and `/project/:id/ungrouped`

**Upload flow:** `ImageUploader.js` exposes a "Use as Group Identifier" dropdown when `FilenameMetadataExtractor` has keys configured. The selected key's extracted value is sent as `group_identifier` in the upload form, causing the backend to find-or-create the group and assign the image.

**CRUD:** `utils/crud.py` contains all group CRUD functions including `get_or_create_image_group`, `get_aggregate_review_status_for_group`, and `has_image_groups`.

**Tests:** `backend/tests/test_groups.py`

## Image Viewer: Interaction Modes, Keyboard Shortcuts, and Navigation

The image viewer (`ImageView.js`) has four interaction modes managed by `hooks/useAnnotations.js`: `pan` (default), `select`, `draw`, `measure`.

**Keyboard shortcut ownership (avoid clashes).** Several independent `keydown` listeners are active at once in the viewer; `preventDefault()` in one does NOT stop the others, so any key bound in more than one place fires multiple actions. To prevent this, certain keys are reserved by their owning handler and MUST NOT be reused:

- `hooks/useAnnotations.js`: `b`/`d` (draw), `v`/`s` (select), `m` (measure), `1`-`9` (select bbox class + draw), `Tab`/`Shift+Tab` (cycle), `Delete`/`Backspace`, `Escape`.
- `components/ReviewPanel.js`: `p` (pass), `r` (reject).
- `ImageView.js`: arrow keys (prev/next image), `?` (help), `c` (comments).
- `components/CompactImageClassifications.js` assigns a single-letter hotkey per project class dynamically. Its `generateHotkeys` reserves all of the above (`h b d v s m p r` and `1-9`) so classification hotkeys can never collide with a mode/review key. If you add a new global viewer shortcut, add its key to that reserved set.

**Navigation.** `loadProjectImages` builds the prev/next list by applying the saved gallery filters (search + review status) for the current `galleryKey`. If the current image is excluded by those filters, it falls back to the full project list so prev/next stay enabled (otherwise both buttons disable). The header "Back" button uses `buildBackDestination()` to return to the originating gallery derived from `galleryKey` (`_ungrouped` -> ungrouped view, `_group_<id>` -> group view, else project page), not always the project root.

## Environment Configuration

Copy `.env.example` to `.env` and configure:

**Critical Settings:**
- `DATABASE_URL`: PostgreSQL connection string (default: `postgresql+asyncpg://postgres:postgres@localhost:5433/postgres`)
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`: Object storage configuration
- `DEBUG`: Set to `true` for development (skips frontend static file serving)
- `PROXY_SHARED_SECRET`: Production authentication shared secret

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


## Claude Code Agents

Custom subagents are defined in `.claude/agents/` for specialized workflows:

- **`pr-review`** -- Comprehensive PR/branch review. Runs tests, checks linting, verifies
  documentation, validates migrations, and performs visual verification with Playwright
  when available. Use before merging any branch.
- **`test-report-runner`** -- Executes the full test suite and reports results factually.
  Also performs visual verification via Playwright if the app is running. Does not suggest
  fixes -- just reports what passed and what failed.
- **`git-worktree-setup`** -- Creates an isolated git worktree as a sibling directory for
  reviewing or testing a branch/PR without disrupting the main checkout. Handles env
  config, port conflicts, dependency installation, and optional tmux session setup.

All agents follow the project conventions: no emojis, professional output, `uv` for Python,
and Playwright-based visual verification when available.

# Pull Request Checklist

Before creating or approving a PR, always verify that relevant documentation has been updated to reflect the changes. Check these files and update as needed:

- `CLAUDE.md` -- architecture, patterns, setup instructions
- `.github/copilot-instructions.md` -- Copilot agent guidance
- `README.md` -- user-facing overview and quick start
- `docs/developer-guide.md`, `docs/api-ml-guide.md` -- detailed guides
- `.env.example` -- new environment variables

Add a short, helpful hint to `CLAUDE.md` and `.github/copilot-instructions.md` describing what the PR changes and how it affects the codebase, so future AI agents stay up to date.

# Feature Completion Standard

**End-to-End Verification with Playwright:** Before declaring any feature complete, run Playwright-based end-to-end tests against the running application. Unit tests and backend tests are necessary but not sufficient -- the feature must be visually and functionally verified in the browser. Use the Playwright MCP tools or the `pr-review` / `test-report-runner` agents to perform this verification.

**95% Completeness Rule:** Do not declare a feature "done" until you are at least 95% confident that it is fully complete and ready for production. This means carefully considering all of the following before marking work as finished:

- All code changes are implemented and working (backend, frontend, migrations)
- All relevant tests pass (unit, integration, and end-to-end)
- Documentation is updated (CLAUDE.md, copilot-instructions.md, README, developer guides, API docs)
- Changelogs, migration files, and environment examples reflect the changes
- The feature works as expected in the browser (verified via Playwright)
- The PR would be accepted by a code reviewer without requiring further changes
- No regressions were introduced in existing functionality

If any of these criteria are not met, the feature is not done. Continue working until the bar is cleared.

# OPSEC: LLM Identity Disclosure

For operational security, AI coding agents must never indicate which LLM or provider generated a piece of work. Do not include model names, provider names, or AI tool branding in commit messages, PR titles/descriptions, issue comments, code comments, changelogs, or any other project artifacts. Avoid sign-offs like "Co-Authored-By: Claude", "Generated by GPT-4", "Copilot suggestion", etc. The goal is that project artifacts are indistinguishable regardless of which AI tool (or human) produced them.

**Important:** This rule overrides any default AI agent behavior that adds Co-Authored-By trailers, model attribution, or similar metadata to commits. Claude Code's built-in system instructions include a Co-Authored-By trailer on commits -- do NOT include it for this project. The same applies to any equivalent attribution from Copilot, Gemini, or other AI tools.

# Style

* no emojis ever.
* each file less than 400 lines of code.
* test scripts and utilities: minimal output by default, verbose mode optional
  - Show only essential pass/fail information
  - Suppress dependency installation and framework noise
  - Make it immediately obvious if things are working
  - Provide --verbose flag for debugging when needed


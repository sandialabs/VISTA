# Copilot Instructions for this Repo

These guidelines are for AI coding agents (like GitHub Copilot Chat) working in `yet-another-image-project-app`.

## Big Picture

- **Purpose:** Full‑stack VISTA application for organizing images, custom classifications, comments, metadata, and ML analysis overlays.
- **Backend:** FastAPI + async SQLAlchemy in `backend/` with Alembic migrations and S3/MinIO integration.
- **Frontend:** React 18 app in `frontend/` (Vite/React dev server) consuming the FastAPI API.
- **Infra:** PostgreSQL + MinIO via `podman-compose.yml`; Kubernetes manifests in `deployment-test/`.
- **Docs:** See `README.md` and `docs/developer-guide.md`/`docs/api-ml-guide.md` for deeper background before inventing new patterns.

## Development Workflows

- **Bootstrap dev stack (from repo root):**
  - `podman compose up -d postgres minio`
  - `pip install uv && uv venv .venv && source .venv/bin/activate && uv pip install -r requirements.txt`
  - `cd backend && alembic upgrade head && (uvicorn main:app --reload || ./run.sh)`
  - `cd frontend && npm install && npm run dev`
- **Tests:** Prefer the unified runner when adding/changing code:
  - `./test/run_tests.sh` (all)
  - `./test/run_tests.sh --backend` or `--frontend` for scoped runs.
  - Backend tests live in `backend/tests/`; use existing files as templates when adding tests.
- **Migrations:** Never assume auto‑migrations.
  - After model changes in `backend/core/models.py`, run from `backend/`:
    - `alembic revision --autogenerate -m "describe change"`
    - Review `backend/alembic/versions/*` and then `alembic upgrade head`.

## Backend Architecture & Patterns

- **Entry point:** `backend/main.py` wires FastAPI app, middleware, and attaches routers from `backend/routers/`.
- **Core modules (`backend/core/`):**
  - `models.py` — SQLAlchemy ORM models (User, Project, DataInstance, ImageClass, MLAnalysis, etc.).
  - `schemas.py` — Pydantic models for request/response schemas.
  - `database.py` — async engine + session utilities.
  - `config.py` — settings via Pydantic `BaseSettings`; do not hardcode env vars.
  - `security.py`, `group_auth.py`, `group_auth_helper.py` — header‑based auth and group membership checks.
- **Routers (`backend/routers/`):** Resource‑oriented FastAPI routers: `projects.py`, `images.py`, `image_classes.py`, `ml_analyses.py`, `api_keys.py`, etc.
  - When adding an endpoint, follow this pattern:
    - Add/extend schemas in `core/schemas.py`.
    - Add DB logic in `backend/crud.py` or a nearby helper.
    - Add route in the relevant `backend/routers/<resource>.py`.
    - Register dependencies (auth, group checks, caching) the same way nearby endpoints do.
- **Middleware (`backend/middleware/`):**
  - `auth.py` — enforces header‑based auth (proxy or mock user in dev), sets `request.state.user_email`.
  - `body_cache.py` — caches request bodies for HMAC verification.
  - `security_headers.py`, `cors_debug.py` — security/CORS behavior.
- **Utilities (`backend/utils/`):**
  - `boto3_client.py` — S3/MinIO access and presigned URL helpers.
  - `dependencies.py` — FastAPI dependencies (auth, HMAC verification, group checks, cache).
  - `cache_manager.py` (and related tests) — centralized caching behavior; reuse instead of ad‑hoc caches.

## ML Pipeline Integration

- High‑level flow (see `docs/api-ml-guide.md` and `scripts/README_YOLOV8.md`):
  1. Client/API key: `POST /api-key/images/{image_id}/analyses` (via `routers.ml_analyses`).
  2. External ML pipeline: status updates, artifact presign, annotation bulk upload, finalize via `/api-ml/...` routes.
  3. Storage: artifacts and results stored in MinIO/S3 using `utils/boto3_client.get_presigned_*` helpers.
- **Security:** ML callback endpoints use HMAC auth.
  - HMAC secret: `ML_CALLBACK_HMAC_SECRET`.
  - Headers validated by `utils.dependencies.require_hmac_auth` (do not bypass; reuse in new ML‑facing routes).
- When modifying this flow, mirror existing patterns in `backend/routers/ml_analyses.py` and tests under `backend/tests/test_image_classifications_router.py`, `test_ml_pipeline.py` (in `scripts/`).

## Frontend Architecture & Patterns

- React app under `frontend/`:
  - `src/App.js`, `src/Project.js`, `src/ImageView.js` as main views.
  - Reusable components in `src/components/` (e.g., `ImageGallery.js`, `MLAnalysisPanel.js`, `BoundingBoxOverlay.js`, `HeatmapOverlay.js`, `ImageClassifications.js`).
- Follow existing data‑fetching and state patterns:
  - Use the same API paths and payload shapes defined by backend routers/schemas.
  - Reuse helper components instead of duplicating UI logic for images, classes, and analyses.

## Conventions & Constraints

- **No emojis** anywhere (code, tests, logs, docs, or tool output).
- Prefer small, focused files (see `docs/developer-guide.md` — ~400‑line guideline).
- Keep auth, group membership, and soft‑delete rules consistent by copy‑adapting nearby endpoints instead of inventing new ones.
- For S3/MinIO interaction, always go through `utils/boto3_client.py` rather than creating new clients.
- When adding features:
  - Backend: router + CRUD + schemas + tests (`backend/tests/`), and migrations if DB models change.
  - Frontend: view + components under `frontend/src/components/` with matching tests if applicable.

## Useful References

- High‑level overview & quick start: `README.md`.
- Detailed backend/frontend/infra docs: `docs/developer-guide.md`.
- ML API details: `docs/api-ml-guide.md` and `scripts/README_YOLOV8.md`.
- Existing AI guidance for this repo: `CLAUDE.md` (good architectural summary—keep new patterns aligned).

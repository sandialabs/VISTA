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
  - `pip install uv && uv sync`
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
- **Routers (`backend/routers/`):** Resource‑oriented FastAPI routers: `projects.py`, `images.py`, `image_classes.py`, `ml_analyses.py`, `api_keys.py`, `export.py`, etc.
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

## Analyze Pipeline Studio

- Pipeline Studio methods live under `backend/analyze_toolbox/`; OpenCV and SAM blocks are toolkit-backed adapters in `backend/utils/segmentation_integrations/`.
- Keep OpenCV/SAM native toolkit imports lazy in adapter runtime loaders so pytest-xdist collection does not import native extensions in worker startup.
- GitLab CI runs backend tests through `test/run_tests.sh --backend` with `BACKEND_TEST_WORKERS=2`; keep CI-compatible backend coverage in that wrapper rather than adding separate pytest commands.
- Analyze execution must accept ordinary image bytes and representative slices from `.npy`, `.npz`, `.inspiro`, and multi-frame TIFF volume images. Source bytes may come from object storage or inline metadata as raw base64/data URLs; strip and validate data URL wrappers before decoding. Preserve the default OpenCV `options.min_peak_distance_px = 1` and SAM foreground fallback behavior so Run Example works with no custom parameters.

## Frontend Architecture & Patterns

- React app under `frontend/`:
  - `src/App.js`, `src/Project.js`, `src/ImageView.js` as main views.
  - Reusable components in `src/components/` (e.g., `ImageGallery.js`, `MLAnalysisPanel.js`, `BoundingBoxOverlay.js`, `HeatmapOverlay.js`, `ImageClassifications.js`).
- Follow existing data‑fetching and state patterns:
  - Use the same API paths and payload shapes defined by backend routers/schemas.
  - Reuse helper components instead of duplicating UI logic for images, classes, and analyses.
  - `FilenameMetadataExtractor.js` provides optional metadata extraction from filenames during upload (simple delimiter or regex mode). It is integrated into `ImageUploader.js` and merges extracted metadata with manually entered JSON (manual values take precedence).

## Excel Export

- `GET /api/projects/{project_id}/export-excel` returns a styled `.xlsx` file (one row per non-deleted image).
- Backend: `routers/export.py` (uses `openpyxl`); bulk-fetches classifications, comments, and users to avoid N+1 queries.
- Frontend: shared download helper in `src/utils/downloadExcel.js`, used by both `Project.js` and `ProjectReport.js`.
- Columns are fully dynamic: Filename (always), then one column per unique `metadata_json` key found across all project images, then Review Status / Reviewer / Review Date (most recent review), then Image Classes, then Comment. No hardcoded field names.
- Tests: `backend/tests/test_export.py`.

## Image Grouping

Images can be organized into named groups (e.g., by part or serial number) using the `image_groups` table.

- `image_groups`: `id`, `project_id`, `identifier` (unique per project), `display_name`; `data_instances.group_id` FK added (nullable).
- Migration: `backend/alembic/versions/20260306_0004_add_image_groups.py`.
- Backend router: `routers/groups.py` -- CRUD endpoints at `/api/projects/{id}/groups`, `/api/groups/{id}`, `/api/groups/{id}/images`, `/api/projects/{id}/has-groups`.
- Upload (`POST /api/projects/{id}/images`) accepts optional `group_identifier` for non-PT1 group assignment. PT1 uploads must not pre-assign images to groups or inspection parts; PT1 image-to-part assignment happens in Project Data -> Images to Parts.
- List images supports `?group_id=` and `?ungrouped=true` filters.
- Frontend: `GroupedImagesPage.js` (project groups overview), `GroupGalleryView.js` (gallery for one group), `ImageGroupPanel.js` (sidebar in ImageView).
- `Project.js` calls `/api/projects/{id}/has-groups` on load; if true, renders `GroupedImagesPage` instead of the flat `ImageGallery`.
- `ImageUploader.js` shows a "Use as Group Identifier" dropdown for non-PT1 projects when `FilenameMetadataExtractor` keys are configured.
- Tests: `backend/tests/test_groups.py`.

## Proxy-Asserted Group Membership

With `VISTA_AUTH_BACKEND=custom`, group membership comes from the groups the reverse proxy asserts, not from a stub that raises.

- `get_current_user` (proxy path, after the `X-Proxy-Secret` check) reads `X_USER_GROUPS_HEADER` (default `X-Forwarded-Groups`) and calls `group_snapshot.record(email, groups)`. Each proxied request replaces the user's groups; a missing header means none.
- `core/group_snapshot.py` keeps them in memory and in the `user_group_snapshots` table (model `UserGroupSnapshot`, migration `backend/alembic/versions/20261109_0011_add_user_group_snapshots.py`). `is_member(email, group)` is synchronous and memory-only, so existing `is_user_in_group` call sites are unchanged.
- A new API key stores its creator's asserted groups (`api_keys.groups`, migration `20261110_0012`). They do not expire; deactivating the key revokes them. `_resolve_from_api_key` sets `User.key_groups` (never serialized) and `is_user_in_group(email, group, user)` answers from it for that user only, so call sites that have the user pass it as the third argument. Keys made before the migration (`groups` NULL) use their owner's last-asserted groups instead.
- The MCP server, background tasks and legacy keys carry no proxy headers; they get their user's last-asserted groups for `GROUPS_SNAPSHOT_TTL_SECONDS` (default 7 days). `GROUPS_SNAPSHOT_REFRESH_SECONDS` (default 60) sets how often each process reloads the table. The API and MCP server start the reload through their lifespans (`group_snapshot.running()`).
- `custom` without `PROXY_SHARED_SECRET` refuses to start unless `DEBUG` or `SKIP_HEADER_CHECK` is on. Group names may not contain commas.
- `utils/boto3_client.py` uses boto3's default credential chain when `S3_ACCESS_KEY` or `S3_SECRET_KEY` is empty.
- Docs: `docs/production/proxy-setup.md`. Tests: `backend/tests/test_group_snapshot.py`.

## Inspection Workbench All Part

- `InspectionWorkbenchPanel` renders a frontend-only `All` row above real inspection parts using the reserved selection ID `__all_parts__`.
- `All` aggregates mapped, loaded images from the currently visible/filtered parts so view and modality toggles can show the same view, such as optical top, across every matching part.
- Do not send `__all_parts__` to backend part mutation endpoints. Review updates, annotation edits, image ordering, crop creation, and source-image visibility changes must remain scoped to real parts.
- Real parts use the `Sort images` dropdown for common persisted tile orders; keep it backed by the existing image display order endpoint and hidden for `All` or read-only inspection.
- The `All` row and real part rows are collapsible; collapsed rows should stay single-line summaries.

## Conventions & Constraints

- **No emojis** anywhere (code, tests, logs, docs, or tool output).
- Prefer small, focused files (see `docs/developer-guide.md` — ~400‑line guideline).
- Keep auth, group membership, and soft‑delete rules consistent by copy‑adapting nearby endpoints instead of inventing new ones.
- For S3/MinIO interaction, always go through `utils/boto3_client.py` rather than creating new clients.
- When adding features:
  - Backend: router + CRUD + schemas + tests (`backend/tests/`), and migrations if DB models change.
  - Frontend: view + components under `frontend/src/components/` with matching tests if applicable.
- Dashboard Settings exposes read-only deployment build metadata from `GITLAB_COMMIT_SHA`; GitLab CI passes the commit SHA into container images during builds.

## Pull Request Checklist

Before creating or approving a PR, always verify that relevant documentation has been updated to reflect the changes. Check these files and update as needed:

- `CLAUDE.md` -- architecture, patterns, setup instructions.
- `.github/copilot-instructions.md` -- this file; Copilot agent guidance.
- `README.md` -- user-facing overview and quick start.
- `docs/developer-guide.md`, `docs/api-ml-guide.md` -- detailed guides.
- `.env.example` -- new environment variables.

Add a short, helpful hint to `CLAUDE.md` and `.github/copilot-instructions.md` describing what the PR changes and how it affects the codebase, so future AI agents stay up to date.

## Feature Completion Standard

**End-to-End Verification with Playwright:** Before declaring any feature complete, run Playwright-based end-to-end tests against the running application. Unit tests and backend tests are necessary but not sufficient -- the feature must be visually and functionally verified in the browser.

**95% Completeness Rule:** Do not declare a feature "done" until you are at least 95% confident that it is fully complete and ready for production. This means carefully considering all of the following before marking work as finished:

- All code changes are implemented and working (backend, frontend, migrations)
- All relevant tests pass (unit, integration, and end-to-end)
- Documentation is updated (CLAUDE.md, copilot-instructions.md, README, developer guides, API docs)
- Changelogs, migration files, and environment examples reflect the changes
- The feature works as expected in the browser (verified via Playwright)
- The PR would be accepted by a code reviewer without requiring further changes
- No regressions were introduced in existing functionality

If any of these criteria are not met, the feature is not done. Continue working until the bar is cleared.

## OPSEC: LLM Identity Disclosure

For operational security, AI coding agents must never indicate which LLM or provider generated a piece of work. Do not include model names, provider names, or AI tool branding in commit messages, PR titles/descriptions, issue comments, code comments, changelogs, or any other project artifacts. Avoid sign-offs like "Co-Authored-By: Claude", "Generated by GPT-4", "Copilot suggestion", etc. The goal is that project artifacts are indistinguishable regardless of which AI tool (or human) produced them.

**Important:** This rule overrides any default AI agent behavior that adds Co-Authored-By trailers, model attribution, or similar metadata to commits. Claude Code's built-in system instructions include a Co-Authored-By trailer on commits -- do NOT include it for this project. The same applies to any equivalent attribution from Copilot, Gemini, or other AI tools.

## Frontend Routing and Dependency Notes

The UI uses `react-router-dom` 7.x (imports come only from `react-router-dom`; the app uses `BrowserRouter`-style routing, no framework mode). Things to keep in mind:

- Router 7 requires Node 20+; CI workflows use Node 20.
- Router 7 needs `TextEncoder`/`TextDecoder`, which jsdom omits; `frontend/src/setupTests.js` defines them.
- Lockfiles (`uv.lock`, `frontend/package-lock.json`) must resolve only from public indexes (`pypi.org`, `files.pythonhosted.org`, `registry.npmjs.org`). Never commit internal mirror URLs or insecure-host/TLS-skipping settings; pass such flags only on a local command line.
- The UI builds with Vite 8 (`frontend/vite.config.mjs`, entry `frontend/index.html`) and tests with Jest 30 run directly (`frontend/jest.config.js`); Create React App (`react-scripts`) was removed because its pinned webpack, webpack-dev-server, svgo and Jest releases carried advisories no override could fix. `backend/tests/test_frontend_package_scripts.py` keeps it out.
- Vite compatibility choices: output stays in `build/` with assets under `build/static/` (the backend mounts only `/static`); JSX in `.js` files is compiled by the `vista:jsx-in-js` plugin in `vite.config.mjs` (oxc treats `.js` as plain JS, and is stricter than Babel: JSX text may not contain a bare `>`, write `&gt;`); `process.env.NODE_ENV` and `REACT_APP_*` variables are inlined as before; the dev server reads `HOST`/`PORT` and proxies `/api` to `REACT_APP_BACKEND_URL` (replacing `src/setupProxy.js`). Vite and the dev image need Node 20.19 or newer (`Dockerfile.dev` enables the `nodejs:22` module stream).
- `frontend/jest.config.js` reproduces the react-scripts Jest defaults: `resetMocks: true`, the CSS and file transforms in `frontend/config/jest/`, a global `fetch` stub (`config/jest/polyfills.js`, replacing `react-app-polyfill/jsdom`), and the Jest 27 snapshot format. Jest 30 honors package `exports`, so `moduleNameMapper` points `react-router/dom` and the ESM-only `flexlayout-react` at loadable files; do not remove those entries.
- Vite's dev server serves each source module by its own URL, so e2e mocks must not use the glob `'**/api/**'`, which also matches `/src/api/*.js` and breaks the app in dev mode (the nightly CI e2e run uses the dev server). Use `API_REQUEST` from `frontend/e2e/fixtures/apiRoutes.js` or a specific `**/api/<path>` pattern. Workers whose files use `import` must be created with `{ type: 'module' }` (see `pt3SplatAssetWorker.js`).
- Lint uses an ESLint 9 flat config (`frontend/eslint.config.mjs`) that carries over the `eslint-config-react-app` rules, including `caughtErrors: 'none'`. ESLint 9 is the newest major `eslint-plugin-react` supports.
- `frontend/package.json` `overrides` force fixed `glob` (14.0.2) and `minimatch` (11.0.1 for the 7.x and later copies) under Jest. `npm audit` reports only `deepmerge` (low, no fixed release exists), through `jest-config`.

## Container Image Scan

`scripts/scan_image.sh IMAGE` exports an image's filesystem and scans it with Syft and Grype (run as containers), printing severity counts and the unfixed Critical and High total. `--compare PREVIOUS_grype.json` shows the change from an earlier scan, `--fail-on high` makes it exit non-zero, `--verbose` lists the worst packages. On networks that inspect TLS, point `SCAN_CA_BUNDLE` at a PEM bundle that includes the proxy's CA (verification is never disabled). Directory scans are used because Syft rejects the PyTorch layers of a full image archive as a decompression bomb. Test: `backend/tests/test_container_build_config.py`.

## Container OpenCV Build (No FFmpeg)

The production `Dockerfile` installs a prebuilt `opencv-python-headless` wheel from `vendor/opencv/` (offline, `--require-hashes`), compiled from the hash-pinned PyPI source distribution with `-DWITH_FFMPEG=OFF`, because the PyPI wheels bundle FFmpeg libraries (and OpenSSL 1.1.1k) that carry unpatched CVEs. The image build no longer compiles OpenCV. Things to keep in mind:

- Video decoding and writing through `cv2` (`VideoCapture`, `VideoWriter` with FFmpeg codecs such as `mp4v`) is unavailable in the image by design. Image I/O, drawing, contours, `dnn`, and ultralytics inference are unaffected (YOLO inference and common cv2 operations were verified bit-identical to the stock wheel).
- `pyproject.toml` has a `[tool.uv] override-dependencies` entry that drops the GUI `opencv-python` distribution (required by ultralytics) from resolution; it bundles its own FFmpeg and shares the `cv2` directory with the headless wheel. Local development and CI test runs still install the stock PyPI headless wheel.
- To bump OpenCV: update `OPENCV_VERSION` and `OPENCV_SDIST_SHA256` in `vendor/opencv/Dockerfile.build` with the `uv.lock` version, rebuild the wheel (instructions in that file and `vendor/opencv/MANIFEST.md`), then replace the wheel and refresh `SHA256SUMS` and `requirements-opencv-prebuilt.txt`. `backend/tests/test_container_build_config.py` fails if the wheel, its pinned hash, `SHA256SUMS`, the recipe and `uv.lock` drift. The wheel is tagged `cp311-abi3` (its `cv2.abi3.so` uses the limited API, so it loads on 3.11 and later, including the image's 3.14; the recipe retags it), linux x86_64 only, and each rebuild adds a 33 MB binary to git history.
- `base` installs nothing (it is `FROM scratch`); runtime OS packages come only from the `rootfs` allowlist, and anything added there ships. The venv lives only in `builder`; a package installed into a copy of it in `final` or `test` would also bypass the lockfile. The `final` stage fails the build if any FFmpeg library or PyPI OpenCV distribution is present.
- Do not run a plain `uv sync` inside the image; it reinstalls the PyPI wheel. Use `uv sync --frozen --inexact --no-install-package opencv-python-headless` (the CI container test does) in the `test` target (`--target test`), which is the only stage with `uv`.
- The wheel's image codecs (libpng, libjpeg, libtiff, libwebp, openjpeg, zlib) are compiled in from OpenCV's own sources and are invisible to image scanners; only FFmpeg is disabled. `vendor/opencv/MANIFEST.md` lists what was verified and the known limits.

## Local Services, OpenCV Adapter, and E2E Notes

- **MinIO image:** the compose files and `deployment-test/minio.yaml` use `cgr.dev/chainguard/minio:latest` because pulls of `minio/minio` were denied on Docker Hub and Quay. It runs as uid 65532 (host bind mounts need `:U` or `chown 65532`), has no `curl`, and is health-checked with `mc ready local`. `test_container_build_config.py` guards against reverting.
- **OpenCV adapter (`utils/segmentation_integrations/opencv_backend.py`):** the built-in watershed runtime returns an object whose masks are under `metadata`; `_normalize_runtime_result` converts it to the dict contract the Analyze consumer reads (top-level `backend`, `mode`, `masks`, `metrics`, with `default` mapped to `watershed`). The child process is started with `_subprocess_env()` (repository root and `backend/` on `PYTHONPATH`), so the image needs no `PYTHONPATH` setting. `native_runtime_disabled()` falls back to the `VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME` environment variable when `core` is not importable.
- **Native segmentation tests** (`VISTA_RUN_NATIVE_SEGMENTATION_TESTS=true`) are off in the default suite and pass when enabled. The SAM and Anomalib smoke tests assert the built-in runtimes' own names (`RuntimeSAMSegmentation`, `RuntimeSAMSegmentationInput`, `vista.patchcore`). The YOLO tests need `yolo11n-seg.pt` (a segmentation model, not `yolov8n.pt`) in `checkpoints/`, the repository root, and `backend/`, or network access to download it; they compare boxes and confidences with a tolerance because inference output varies by machine.
- **E2E specs run against the production container** (`E2E_BASE_URL`), whose Content-Security-Policy is `connect-src 'self'`: do not `fetch()` `data:` URLs in page code or helpers; decode with `atob` and `createImageBitmap`.

## Dev Container Extra CA Certificates

- On networks with TLS inspection (Zscaler), dev image builds fail with `CERTIFICATE_VERIFY_FAILED`. `scripts/dev.sh` stages host CAs from `EXTRA_CA_CERT_SOURCE` (default `/usr/local/share/ca-certificates`; disable with `EXTRA_CA_CERTS_AUTO=false`) into the gitignored `certs/` directory before `up`/`build`.
- `Dockerfile.dev` copies `certs/` into the trust store before any network fetch and sets `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `PIP_CERT`, `NODE_EXTRA_CA_CERTS`, and `UV_NATIVE_TLS=true`. With no certs staged it behaves as before. `certs/.gitkeep` must stay tracked (`.dockerignore` drops `*.md`).
- Fix TLS errors by adding CAs, never with `--trusted-host`, `--insecure`, or `strict-ssl=false`. `backend/tests/test_dev_container_ca_config.py` guards this. The production `Dockerfile` does not consume `certs/`.
- Compose files and `deployment-test/` use fully qualified image names (`docker.io/library/postgres:15`); Podman without unqualified-search registries rejects short names. `test_container_build_config.py` guards this.
- `scripts/dev.sh` works with podman-compose 1.0.6: it starts `DEV_SERVICES` / builds `DEV_BUILD_SERVICES` explicitly (old podman-compose ignores `profiles:`, which would start the GPU `toolbox-models` service), and waits for health via `podman|docker inspect` on the `com.docker.compose.service` label, running `podman healthcheck run` each poll because Podman healthcheck timers need systemd (often absent in WSL2).
- Podman passes host `http_proxy`/`no_proxy` into containers by default, which sends `http://minio:9000` to a corporate proxy (`RemoteDisconnected`). `backend-dev`, `frontend-dev`, and `backend-test` set `NO_PROXY`/`no_proxy` listing the compose hostnames; add new service hostnames there.

## Useful References

- High‑level overview & quick start: `README.md`.
- Detailed backend/frontend/infra docs: `docs/developer-guide.md`.
- ML API details: `docs/api-ml-guide.md` and `scripts/README_YOLOV8.md`.
- Existing AI guidance for this repo: `CLAUDE.md` (good architectural summary -- keep new patterns aligned).

## Inspection Tile Highlight

- The Inspection View Parts board highlights only one tile for the selected annotation/overlay item, resolved once per board by `findHighlightedInspectionTileId` in `frontend/src/features/inspectionWorkbench/inspectionTileHighlight.js` and passed to tiles as `isHighlighted`. Same-view overlays sharing a base image are not highlighted together.

## Inspection Annotation Ownership

- Each annotation belongs only to the image it was drawn on. `getAnnotationSourceImageId` (`frontend/src/features/inspectionWorkbench/partImageRefs.js`) returns the tile's own image id; overlays with `overlay_base_image_id`, Analyze outputs, and same-view images in other modalities do not render, save to, or highlight the base image's annotations. The base image is still drawn under an overlay as a visual backdrop only. Do not reintroduce a base-image lookup for annotation ownership.

## Inspection Draw Tools Own the Pointer

- While Measure, Draw box, or Crop is active, existing shapes render without move/edit hit targets in both fullscreen (`FullscreenAnnotationHandles.js`) and tiles (`annotationDrawToolActive` in `centerPaneProps.js`), so users can draw over existing annotations. Any hit target layered above the fullscreen `<img>` triggers its `onMouseLeave` and cancels the tool.

## Inspection Shape Drag Commit

- Tile, fullscreen, and MPR shape drags save through `commitDraggedGeometry` (`frontend/src/features/inspectionWorkbench/annotationDragCommit.js`), which keeps the drag preview at the drop position until the PATCH resolves. Clearing the preview before the save lands makes the shape flash back to its original position.

## Inspection Annotation Overlay Scaling

- Annotation overlays (tile, fullscreen, MPR) use `AnnotationOverlaySvg` and a uniform design-unit frame from `frontend/src/features/inspectionWorkbench/annotationOverlayFrame.js`, so line thickness, handle dots, and label text are identical across image aspect ratios. Pass `frame` to the annotation renderers and project coordinates with the frame helpers; never wrap annotation content in a non-uniform `scale(w/1000 h/1000)` group.

## Container Image Hardening (Phased)

- Phase 1: the production `Dockerfile` builds the React bundle in a separate `ui` stage (`ubi9/nodejs-22`, pinned by digest, `ARG UBI_NODEJS`). Only `/app/frontend/build` is copied into `final` (`COPY --from=ui`). Node and npm are no longer installed in `base`, so the runtime image has none (about 300 fewer High findings). Do not add `nodejs`/`npm` back to `base`; `test_container_build_config.py` guards this.
- Phase 2: the `base` stage installs only `python3.11` and `ca-certificates` (after `microdnf upgrade`; `python3.11-pip` was dropped in Phase 4). Compilers, `-devel` headers, git, wget and the GTK/X11/browser libraries are gone; all dependencies are prebuilt wheels. The SAM weights come from a `checkpoints` stage (curl plus a pinned SHA-256, `ARG SAM_VIT_B_SHA256`) and are copied into `final`. Scan: 4 Critical / 105 High -> 0 Critical / 34 High (findings 1158 -> 300); the remaining Highs are unfixed upstream OS packages. A package needed at runtime must be added to `base` deliberately; `test_container_build_config.py` rejects the denylisted ones.
- Phase 3: `ubi-minimal` (`ARG UBI_MINIMAL`) and the Node image are pinned by digest; bump the digests deliberately to pick up base fixes. `debugpy` is no longer installed, the image upgrades `setuptools` next to `pip` and `uv`, and `uv.lock` carries `fastmcp` 4.1.8 and `mcp` 2.3.0 (moved from 3.4 and 1.30 afterwards; the MCP server needed no code change), `opentelemetry-api` 1.45.1 and `setuptools` 84.1.0. Scan: 34 -> 32 High, findings 300 -> 290; the one remaining Python finding is `diskcache`, which has no fix.
- Phase 4: the venv is created in `builder` with `uv venv` (seedless: no OS-seeded setuptools or pip) and copied into `final`, so the production image has no pip, uv, Node, compilers or git. `final` is followed by a `test` stage (final plus the `uv` binary, `pyproject.toml` and `uv.lock`) and a trailing `release` alias, so a plain `docker build .` still produces the production image. CI (`docker-image.yml`) builds `--target test`, tags it `:test`, and runs the container checks there (`uv sync --frozen --inexact --no-install-package opencv-python-headless`); the push step builds the default target. Do not give `test` a `WORKDIR`: CI starts uvicorn from the inherited `/app/backend`. Scan: 290 -> 284 findings, 0 Critical, 32 High (all unfixed upstream OS packages), 1 Python Medium (`diskcache`, no fix).
- Phase 5: the production image runs as uid 10001 (`vista`, group 10001; group 0 has the same access for OpenShift arbitrary UIDs). Code, `/opt/venv` and `/app/checkpoints` stay root-owned and read-only. Writable state: `/var/cache/vista` (`CACHE_DIR`, image-level default), `/app/backend/logs`, `/app/backend/tmp`, `/home/vista` (`HOME`) and `/tmp`. If you mount a volume over any of these, make it writable by uid 10001 or group 0. The `test` stage switches back to `USER 0` because CI installs dev dependencies into `/opt/venv`. `yolo11n-seg.pt` is now bundled (checkpoints stage, SHA-256 pinned, symlinked into `/app/backend`) instead of downloaded on first use, because ultralytics saves bare-name downloads into the working directory, which the non-root user cannot write. Scan is unchanged at 284 findings (0 Critical, 32 High).
- Phase 6: `base` runs `microdnf upgrade` and `install` with `--setopt=install_weak_deps=0`, which keeps out `glibc-langpack-en`, `gawk-all-langpacks` (pulled in by glibc 2.34-290.el9_9) and `libxcrypt-compat` (nothing links the system `libcrypt.so.1`; `psycopg2-binary` bundles its own). `test_container_build_config.py` guards the option. A cached `microdnf upgrade` layer keeps old packages, and CI builds with `cache-from: type=gha`, so OS fixes land only when the `base` lines or digests change; a `latest` tag can point at an older build than the pinned digest, so compare `build-date` labels before bumping. Every GitHub Action is pinned to a commit SHA with its release in a trailing comment (`@<sha> # vX.Y.Z`); keep new `uses:` lines in that form. `deploy.yml` passes `workflow_dispatch` inputs to shell through `env:`, never `${{ }}` inside `run:`. Scan of the refreshed base: 0 Critical, 31 High (all unfixed upstream: krb5-libs, sqlite-libs, python3.11, expat, json-glib, util-linux CVE-2026-53615), findings 291 -> 282.
- Phase 7: Python 3.14 and a package-manager-free runtime. `base` is `FROM scratch` plus two stages: `rootfs` (`dnf --installroot` from the digest-pinned `ubi9/ubi`, only glibc, bash, coreutils-single, libstdc++, libgcc, zlib, ca-certificates and tzdata, weak dependencies off; the build fails if krb5-libs, sqlite-libs, expat, json-glib, util-linux libraries, python3.11, rpm or dnf get in) and `python` (python-build-standalone CPython, `ARG PBS_RELEASE`/`PBS_PYTHON`/`PBS_SHA256`, pip/ensurepip/IDLE/Tk pruned). Scan: 31 High -> 0 High, 0 Critical. OpenSSL, SQLite and expat are statically linked inside `/opt/python`, so scanners cannot see them; `scripts/scan_image.sh` prints their versions, and bumping the three PBS ARGs (in `Dockerfile` and `Dockerfile.dev`, kept identical by a test) is how they get patched. `builder` is plain ubi-minimal with `/opt/python` at the same path and uv from the digest-pinned `ghcr.io/astral-sh/uv` image (`UV_IMAGE`). `base` sets an explicit `PATH`, `SSL_CERT_FILE` and `LANG=C.UTF-8` (scratch has none); `final` checks FFmpeg absence and CA loading in Python (no find/grep) and the runtime user's shell is `/usr/bin/false`. `ldconfig` ships for the NVIDIA CDI hook. CI passes `OS_REFRESH` (ISO week, same value for every build step) so the `rootfs` install re-runs weekly despite the GHA cache. Tests: `test_container_python_runtime_config.py`, `test_container_ca_secret_config.py`.
- Local builds behind TLS inspection: `VISTA_EXTRA_CA_FILE=/path/outside/repo/ca.pem scripts/build_image.sh [--target test]`. The CA is a build secret (`extra_ca`) mounted only by the download steps of `python`, `checkpoints`, `ui`, `builder` and the OpenCV recipe, combined with the system bundle on a tmpfs, never in a layer, the build context or git; `scripts/check_image_ca.sh IMAGE CA_FILE` (run by the helper) proves it is absent. CI passes no secrets (a test enforces it). Never disable TLS verification instead.
- `diskcache` (pickle) is replaced by `utils/file_cache.py`: JSON header plus raw bytes, only JSON types, bytes and tuples, atomic writes, LRU eviction by mtime under `CACHE_SIZE_MB`, `<kind>:<uuid>:` invalidation removes one directory. Store Pydantic models as `model_dump(mode="json")` and validate on read. `minio` (unused) is gone and `fastapi[all]` became `fastapi` plus `pydantic[email]`.
- GPU: `utils/accelerator.py` (`resolve_torch_device`, `VISTA_MODEL_SERVICE_DEVICE=auto` picks cuda:0, then mps, then cpu) places SAM, both YOLO paths and Anomalib. Trained Anomalib checkpoints run through the real `anomalib` package (`segmentation_integrations/anomalib_runtime.py`, `weights_only=True`, `pre_trained=False`); untrained requests keep the built-in `vista.patchcore` scorer. Both images set `ULTRALYTICS_SAFE_LOAD=1`, so YOLO checkpoints load with `weights_only=True` plus ultralytics' class allowlist instead of a full unpickle (SAM already gets torch's `weights_only=True` default); do not remove it. Run the image on a GPU with `podman run --device nvidia.com/gpu=all` (NVIDIA Container Toolkit plus a CDI spec). Native GPU tests: `backend/tests/test_native_gpu_runtimes.py` (opt-in).

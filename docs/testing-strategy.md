# Vista Testing Strategy

Vista's tests are organized as a layered, efficient pyramid: deterministic unit tests at the base, API/router integration tests in the middle, and a small set of Playwright end-to-end tests for user-critical workflows.

## Test commands

| Layer | Command | Purpose |
| --- | --- | --- |
| Backend smoke | `pytest -q -m smoke` | Runs representative authentication, project, upload, grouping, inspection, analysis, export, and deletion workflows in seconds. |
| Backend unit and API integration | `pytest -q -m "not postgres"` | Runs FastAPI router, CRUD, model/schema, cache, security, export, metadata, and analysis toolbox tests. |
| PostgreSQL integration | `cd backend && VISTA_POSTGRES_TEST_DATABASE_URL=postgresql+asyncpg://user:pass@localhost/vista_test python -m pytest -q -m postgres tests/postgres` | Runs Alembic, native server-default/timezone, transactional, proxy-auth, and deletion-audit contracts serially against a disposable PostgreSQL database. |
| Frontend unit/component | `cd frontend && CI=true npm run test:unit:ci` | Runs React Testing Library/Jest tests once in-band for deterministic CI behavior. |
| Frontend end-to-end | `cd frontend && npm run test:e2e` | Runs Playwright workflows against the React app with network mocks. |
| Frontend cross-browser | `cd frontend && npm run test:e2e:browsers` | Runs the Playwright E2E suite in Chromium-family Chrome/Edge projects and Firefox. |
| Frontend all | `cd frontend && npm run test:ci` | Runs the frontend unit suite followed by Playwright E2E tests. |

## Playwright in CI

Playwright does not run on every push or merge request; it is slow relative to the Jest and build checks, which do run on every push. GitHub Actions (`.github/workflows/docker-image.yml`) runs it only on a nightly schedule, covering `full-inspection-workflow.spec.js`, `inspection-workbench.spec.js`, and `pt3-fullscreen-annotation-parity.spec.js`. Run `cd frontend && npm run test:e2e` locally to get Playwright coverage on a feature branch before it reaches the nightly run.

## Cross-browser deployment checks

Use the Playwright browser matrix when a glitch appears for some users, operating systems, or browsers but not others. Install the test browsers once on each test machine:

```bash
cd frontend
npm run test:e2e:install-browsers
```

Run the matrix locally against the React dev server:

```bash
cd frontend
npm run test:e2e:browsers
```

Run the same matrix against a deployed Vista URL by setting `E2E_BASE_URL`. When this variable is present, Playwright does not start the local dev server:

```bash
cd frontend
E2E_BASE_URL=https://vista.example.com npm run test:e2e:browsers
```

To isolate one browser while debugging, pass a Playwright project name:

```bash
cd frontend
E2E_BASE_URL=https://vista.example.com npm run test:e2e:browsers -- --project=firefox
E2E_BASE_URL=https://vista.example.com npm run test:e2e:browsers -- --project=edge
E2E_BASE_URL=https://vista.example.com npm run test:e2e:browsers -- --project=chrome
```

On Linux x64, the install command downloads Playwright Chromium and Firefox, then extracts Google Chrome and Microsoft Edge under `frontend/.local/` without requiring administrator privileges. On other platforms, install Chrome and Edge normally. To run against system-installed Google Chrome and Microsoft Edge instead of the no-sudo local copies, set `E2E_REAL_BROWSERS=true`:

```bash
cd frontend
E2E_REAL_BROWSERS=true npm run test:e2e:browsers
```

Failed runs write traces, screenshots, and the HTML report under `frontend/artifacts/playwright-report/` and `frontend/test-results/`. Compare the same failing spec across `chrome`, `edge`, and `firefox` first, then rerun headed with `-- --headed --project=<browser>` on the affected user platform.

`test/run_tests.sh` runs the backend suite before the frontend suite. The
standalone backend wrapper excludes the opt-in PostgreSQL lane, uses
pytest-xdist when the plugin is installed, and honors `BACKEND_TEST_WORKERS=0`
for serial runs. CI uses the same backend wrapper inside the production
image with `BACKEND_TEST_WORKERS=2` and publishes JUnit output, so the runner
keeps the project/API/analysis/export/auth coverage while avoiding a separate,
CI-only pytest command. The native OpenCV/SAM imports stay behind lazy adapter
loaders so pytest-xdist collection does not import those runtimes during the
general backend suite.

## User-story coverage matrix

| Vista user story | Primary unit/API coverage | End-to-end coverage |
| --- | --- | --- |
| Create, list, archive, and summarize projects | `backend/tests/test_projects_router.py`, `backend/tests/test_project_dashboard_counts.py`, `frontend/src/__tests__/Project.test.js`, `frontend/src/App.test.js` | `frontend/e2e/specs/full-inspection-workflow.spec.js` |
| Upload, browse, group, and delete images | `backend/tests/test_images_router.py`, `backend/tests/test_image_deletion.py`, `backend/tests/test_groups.py`, `frontend/src/components/__tests__/ImageUploader.test.js`, `frontend/src/components/__tests__/ImageGallery.test.js`, `frontend/src/components/__tests__/GroupedImagesPage.test.js` | `frontend/e2e/specs/full-inspection-workflow.spec.js` |
| Inspect images and preserve visual measurement accuracy | `backend/tests/test_reviews.py`, `frontend/src/__tests__/ImageView.measurements.test.js`, `frontend/src/components/__tests__/MeasurementAccuracy.test.js`, `frontend/src/components/__tests__/MeasurementTool.test.js` | `frontend/e2e/specs/inspection-workbench.spec.js` |
| Run analysis overlays and segmentation workflows | `backend/tests/test_analyze_router.py`, `backend/tests/test_analyze_toolbox_contract.py`, `backend/tests/test_segmentation_integrations.py`, `frontend/src/components/__tests__/AnalyzeWorkbenchTab.test.js`, `frontend/src/components/__tests__/OverlaysTab.test.js` | `frontend/e2e/specs/overlays-autoassign.spec.js` |
| Manage metadata, calibration, exports, and reports | `backend/tests/test_project_metadata_crud.py`, `backend/tests/test_images_metadata_endpoints.py`, `backend/tests/test_export.py`, `frontend/src/components/__tests__/ProjectDataMetadataTab.test.js`, `frontend/src/components/__tests__/ProjectDataExportPanel.test.js`, `frontend/src/components/__tests__/CalibrationManager.test.js` | `frontend/e2e/specs/full-inspection-workflow.spec.js` |
| Authenticate users, groups, and API keys securely | `backend/tests/test_auth_system.py`, `backend/tests/test_unified_auth.py`, `backend/tests/test_groups_auth.py`, `backend/tests/test_api_keys.py`, `backend/tests/test_security_headers.py` | Covered through mocked authorized workflows in Playwright specs. |
| Recover from cache, config, and storage edge cases | `backend/tests/test_cache_manager.py`, `backend/tests/test_cache_limits.py`, `backend/tests/test_config.py`, `backend/tests/test_boto3_client_utils.py`, `backend/tests/test_volume_loader.py`, `frontend/src/utils/__tests__/serviceDiagnostics.test.js` | Not E2E by design; these are faster and more deterministic as unit/API tests. |

## Test design principles

1. Prefer unit tests for pure parsing, serialization, metadata-key, and state-transition logic.
2. Prefer backend API tests for authorization boundaries, validation failures, persistence side effects, cache invalidation, and file-storage behaviors.
3. Prefer frontend component tests for user-visible states, form validation, keyboard/pointer interactions, and API failure rendering.
4. Keep Playwright specs focused on high-value journeys only: project setup, inspection workbench, overlay assignment, upload-to-report flow, and failure recovery that must be validated in a real browser.
5. Every new bug fix should add the lowest-layer regression test that would have caught it; only add E2E coverage when browser integration is the risk.
6. Keep the `smoke` marker on representative existing workflows rather than maintaining a duplicate smoke-only implementation.

## PostgreSQL integration lane

PostgreSQL tests live under `backend/tests/postgres/`, carry the registered
`postgres` marker, and always run serially. The normal backend runner excludes
that marker so its SQLite suite cannot overlap the dedicated database lane.

Set `VISTA_POSTGRES_TEST_DATABASE_URL` to an explicitly disposable database to
opt in. Its database name must start with `test_` or end with `_test`; generic
databases such as `postgres` and the PostgreSQL templates are rejected. The
fixture upgrades the database with Alembic and truncates application tables
between tests. CI also verifies an incremental migration from `20260428_0008`
to `head` before running these contracts.

## Security scan gates

The security workflow publishes scanner output before enforcing its result.
Trivy gates HIGH/CRITICAL container findings. Safety, Bandit, and Semgrep
likewise retain their reports and fail closed when a scan fails or does not
produce a status.

## Red-team robustness checklist

Use this checklist when adding or refactoring tests:

- Empty projects, empty image groups, and missing optional metadata.
- Malformed image IDs, path traversal attempts, and unsupported file types.
- API 401/403/404/409/422/500 responses surfaced as actionable UI states.
- Rapid repeated clicks, interrupted uploads, stale cache entries, and deleted resources reopened from history.
- Large metadata payloads, unusual Unicode filenames, duplicate names, and mixed project types.
- Browser viewport changes, splitter resizing, keyboard-only operation, and focus restoration after modals.

## Done criteria for test refactors

A test refactor is complete only when:

- Backend tests pass with `pytest -q -m "not postgres"` after installing project dependencies.
- PostgreSQL integration tests pass serially when database-sensitive behavior changes.
- Frontend unit tests pass with `CI=true npm run test:unit:ci`.
- Playwright tests either pass with `npm run test:e2e` or have a documented environment blocker such as missing system browser dependencies.
- Any new test helpers are shared rather than duplicated and do not hide unexpected console errors.

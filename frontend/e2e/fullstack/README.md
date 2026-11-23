# Full-stack end-to-end tests

These specs run against the **real** FastAPI backend (no `page.route` mocks).
They seed data through the public API, drive the UI only through user actions,
and save screenshots to `frontend/artifacts/dashboard-*.png` for visual review.

## Run

1. A PostgreSQL test database migrated to head:

   ```bash
   cd backend
   DATABASE_URL=postgresql+asyncpg://USER@HOST:PORT/vista_e2e alembic upgrade head
   ```

2. Start the backend in demo-auth mode (not for production):

   ```bash
   cd backend
   DATABASE_URL=postgresql+asyncpg://USER@HOST:PORT/vista_e2e \
   FAST_TEST_MODE=true DEBUG=false SKIP_HEADER_CHECK=true \
   VISTA_AUTH_BACKEND=demo ENV=development DISABLE_FILE_LOGGING=true \
   MOCK_USER_EMAIL=e2e@example.com \
   MOCK_USER_GROUPS_JSON='["inspection-line-a","inspection-line-b","empty-new-group"]' \
   uvicorn main:app --host 127.0.0.1 --port 8000
   ```

   `FAST_TEST_MODE` skips the S3 bucket check; the dashboard specs do not
   upload files.

3. Run the specs (starts Vite on :3000 unless `E2E_BASE_URL` is set):

   ```bash
   cd frontend
   npx playwright test --config=playwright.fullstack.config.js
   ```

Each run uses unique names, but folder names such as "Batch 8" repeat; start
from an empty database (truncate `dashboard_folders` and `projects`) for
deterministic results.

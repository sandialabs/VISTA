// Full-stack Playwright lane: the real FastAPI backend (demo auth, Alembic-
// migrated database) behind the Vite dev server. Nothing is mocked.
//
// Start the backend first (see e2e/fullstack/README.md), then:
//   npx playwright test --config=playwright.fullstack.config.js
//
// Environment:
//   E2E_BASE_URL     UI origin (default http://127.0.0.1:3000; the Vite dev
//                    server is started automatically when unset)
//   E2E_BACKEND_URL  backend origin used by specs for seeding
//                    (default http://127.0.0.1:8000)
//   CHROMIUM_PATH    optional Chromium executable
const base = require('./playwright.config');

module.exports = {
  ...base,
  testDir: './e2e/fullstack',
  timeout: 90_000,
  reporter: [
    [process.env.CI ? 'dot' : 'list'],
    ['html', { outputFolder: 'artifacts/playwright-fullstack-report', open: 'never' }],
  ],
  use: {
    ...base.use,
    viewport: { width: 1600, height: 1000 },
    screenshot: 'only-on-failure',
  },
};

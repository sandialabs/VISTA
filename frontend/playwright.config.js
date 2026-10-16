const fs = require('fs');
const path = require('path');
const { defineConfig } = require('@playwright/test');

const localChromePath = path.resolve(__dirname, '.local/chrome/chrome-linux64/chrome');
const hasLocalChrome = fs.existsSync(localChromePath);
const chromiumExecutablePath = process.env.CHROMIUM_PATH || (hasLocalChrome ? localChromePath : undefined);
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const shouldStartWebServer = !process.env.E2E_BASE_URL;

module.exports = defineConfig({
  testDir: './e2e/specs',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
  // Keep CI output to one character per test while retaining the HTML report
  // and full failure details. Local runs remain descriptive and easy to scan.
  reporter: [
    [process.env.CI ? 'dot' : 'list'],
    ['html', { outputFolder: 'artifacts/playwright-report', open: 'never' }],
  ],
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium-local',
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: chromiumExecutablePath,
          args: ['--no-sandbox'],
        },
      },
    },
  ],
  ...(shouldStartWebServer ? {
    webServer: {
      command: 'HOST=127.0.0.1 PORT=3000 npm start',
      url: baseURL,
      reuseExistingServer: true,
      timeout: 180_000,
    },
  } : {}),
});

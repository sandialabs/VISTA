const { defineConfig } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const baseConfig = require('./playwright.config');

const chromiumArgs = process.platform === 'linux' ? ['--no-sandbox'] : [];
const chromeChannel = process.env.PLAYWRIGHT_CHROME_CHANNEL || (process.env.E2E_REAL_BROWSERS === 'true' ? 'chrome' : undefined);
const edgeChannel = process.env.PLAYWRIGHT_EDGE_CHANNEL || (process.env.E2E_REAL_BROWSERS === 'true' ? 'msedge' : undefined);
const localChromePath = path.resolve(__dirname, '.local/google-chrome/opt/google/chrome/chrome');
const localEdgePath = path.resolve(__dirname, '.local/microsoft-edge/opt/microsoft/msedge/msedge');
const chromeExecutablePath = process.env.CHROME_PATH || (chromeChannel ? undefined : fs.existsSync(localChromePath) ? localChromePath : undefined);
const edgeExecutablePath = process.env.EDGE_PATH || (edgeChannel ? undefined : fs.existsSync(localEdgePath) ? localEdgePath : undefined);

module.exports = defineConfig({
  ...baseConfig,
  projects: [
    {
      name: 'chrome',
      use: {
        browserName: 'chromium',
        channel: chromeChannel,
        launchOptions: {
          executablePath: chromeExecutablePath,
          args: chromiumArgs,
        },
      },
    },
    {
      name: 'edge',
      use: {
        browserName: 'chromium',
        channel: edgeChannel,
        launchOptions: {
          executablePath: edgeExecutablePath,
          args: chromiumArgs,
        },
      },
    },
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
      },
    },
  ],
});

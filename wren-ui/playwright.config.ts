import { defineConfig, devices } from '@playwright/test';

const E2E_PG_URL =
  process.env.E2E_PG_URL ||
  process.env.PG_URL ||
  'postgres://postgres:postgres@127.0.0.1:9432/wrenai_e2e';
const E2E_AI_PG_URL = E2E_PG_URL.replace(/^postgres:\/\//, 'postgresql://');
const E2E_UI_PORT = Number(process.env.E2E_UI_PORT || '3000');
const E2E_AI_PORT = Number(process.env.E2E_AI_PORT || '5556');
const E2E_DIST_DIR = '.next-e2e';
const E2E_BASE_URL =
  process.env.E2E_BASE_URL || `http://127.0.0.1:${E2E_UI_PORT}`;
const E2E_AI_ENDPOINT =
  process.env.E2E_AI_ENDPOINT || `http://127.0.0.1:${E2E_AI_PORT}`;
const reuseExistingServer = process.env.PW_REUSE_SERVER === '1';
const uiServerMode = process.env.PW_UI_SERVER_MODE || 'dev';
const skipWebServer = process.env.PW_SKIP_WEBSERVER === '1';

const uiServerCommand =
  uiServerMode === 'standalone'
    ? `rm -rf ${E2E_DIST_DIR} && NEXT_DIST_DIR=${E2E_DIST_DIR} yarn build && NEXT_DIST_DIR=${E2E_DIST_DIR} node scripts/prepare_playwright_standalone.mjs && NEXT_DIST_DIR=${E2E_DIST_DIR} PORT=${E2E_UI_PORT} HOSTNAME=127.0.0.1 NODE_ENV=test PG_URL=${E2E_PG_URL} WREN_AI_ENDPOINT=${E2E_AI_ENDPOINT} node ${E2E_DIST_DIR}/standalone/server.js`
    : `rm -rf ${E2E_DIST_DIR} && NEXT_DIST_DIR=${E2E_DIST_DIR} PORT=${E2E_UI_PORT} HOSTNAME=127.0.0.1 NODE_ENV=test PG_URL=${E2E_PG_URL} WREN_AI_ENDPOINT=${E2E_AI_ENDPOINT} TZ=UTC ./node_modules/.bin/next dev --hostname 127.0.0.1 --port ${E2E_UI_PORT}`;

export default defineConfig({
  // Look for test files in the "tests" directory, relative to this configuration file.
  testDir: 'e2e',

  // Each test is given 60 seconds.
  timeout: 1 * 60 * 1000,

  // Fail the build on CI if you accidentally left test.only in the source code.
  forbidOnly: false,

  // Retry on CI only.
  retries: 0,

  // Opt out of parallel tests on CI.
  workers: 1,

  // Reporter to use
  reporter: 'html',

  use: {
    // Base URL to use in actions like `await page.goto('/')`.
    baseURL: E2E_BASE_URL,

    // Collect trace when retrying the failed test.
    trace: 'on-first-retry',
  },
  // Configure projects for major browsers.
  projects: [
    {
      name: 'setup db',
      testMatch: /global\.setup\.ts/,
      teardown: 'cleanup db',
    },
    {
      name: 'auth setup',
      testMatch: /auth\.setup\.ts/,
      dependencies: ['setup db'],
    },
    {
      name: 'cleanup db',
      testMatch: /global\.teardown\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['auth setup'],
    },
  ],
  // Run your local dev server before starting the tests.
  webServer: skipWebServer
    ? []
    : [
        {
          command: `.venv/bin/python .venv/bin/uvicorn src.__main__:app --host 127.0.0.1 --port ${E2E_AI_PORT} --loop uvloop --http httptools`,
          cwd: '../wren-ai-service',
          url: `${E2E_AI_ENDPOINT}/health`,
          timeout: 120 * 1000,
          reuseExistingServer,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            CONFIG_PATH: './config.local.yaml',
            PG_CONN_STR: E2E_AI_PG_URL,
            WREN_UI_ENDPOINT: E2E_BASE_URL,
            WREN_AI_SERVICE_HOST: '127.0.0.1',
            WREN_AI_SERVICE_PORT: `${E2E_AI_PORT}`,
          },
        },
        {
          command: uiServerCommand,
          cwd: '.',
          url: E2E_BASE_URL,
          timeout: 5 * 60 * 1000,
          reuseExistingServer,
        },
      ],
});

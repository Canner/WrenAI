import { defineConfig, devices } from '@playwright/test';

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
    baseURL: 'http://127.0.0.1:3000',

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
      name: 'cleanup db',
      testMatch: /global\.teardown\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup db'],
    },
  ],
  // Run your local dev server before starting the tests.
  webServer: {
    command: 'NODE_ENV=test yarn start -p 3000',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: true,
  },
});

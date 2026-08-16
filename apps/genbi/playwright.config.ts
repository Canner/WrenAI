import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5275' },
  webServer: [
    {
      command: 'node e2e/mock-bff.mjs',
      url: 'http://127.0.0.1:4786/health',
      reuseExistingServer: false,
    },
    {
      command: 'VITE_BFF_URL=http://127.0.0.1:4786 pnpm exec vite --host 127.0.0.1 --port 5275',
      url: 'http://127.0.0.1:5275/e2e/xterm-fit.html',
      reuseExistingServer: false,
    },
  ],
});

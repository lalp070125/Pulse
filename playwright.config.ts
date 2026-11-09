import { defineConfig } from '@playwright/test';

// UI smoke tests. They start the real single-port server (npm run dev) and drive a real browser.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4600' },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4600/api/health',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

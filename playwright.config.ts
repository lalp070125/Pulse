import path from 'node:path';
import { defineConfig } from '@playwright/test';

// UI smoke tests. They start the real single-port server (npm run dev) and drive a real browser.
// PULSO_E2E_PORT lets them run beside a server that is already open on 4600.
const port = Number(process.env.PULSO_E2E_PORT ?? 4600);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  reporter: 'list',
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: 'npm run dev',
    url: `http://127.0.0.1:${port}/api/health`,
    // Tests create their own projects in a scratch folder, never in /projects.
    env: {
      PORT: String(port),
      PULSO_PROJECTS_DIR: path.resolve('test-results/projects'),
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

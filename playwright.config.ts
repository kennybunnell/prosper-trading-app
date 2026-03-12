import { defineConfig, devices } from '@playwright/test';

/**
 * Pass 3 — Browser E2E Tests
 * Tests the running Prosper Trading App at http://localhost:3000
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'e2e-results.json' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    // Don't fail on console errors from the app (auth errors are expected when not logged in)
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], headless: true },
    },
  ],
  // Don't start a web server — we use the already-running dev server
  webServer: undefined,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
});

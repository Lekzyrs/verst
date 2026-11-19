import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  use: {
    baseURL: process.env.VERST_URL ?? 'http://localhost:5190/dev/',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npx vite --port 5190 --strictPort',
    url: 'http://localhost:5190/@vite/client',
    reuseExistingServer: true,
  },
});

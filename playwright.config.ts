import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  use: {
    baseURL: process.env.VERST_URL ?? 'http://localhost:5273/dev/',
  },
  projects: [
    // Без этого headless Chromium рисует WebGL программно (SwiftShader, около 20 кадров в секунду), и проверки,
    // которые меряют время покоя сцены, зависят от скорости процессора. На macOS сцену рисует видеокарта через Metal.
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npx vite --port 5273 --strictPort',
    url: 'http://localhost:5273/@vite/client',
    reuseExistingServer: true,
  },
});

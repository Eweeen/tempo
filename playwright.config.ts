import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  retries: 0,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 1000 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    colorScheme: 'light',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  // Production preview is essential: service workers are disabled in dev mode.
  // Run `npm run build` before these tests so cached assets match current source.
  webServer: {
    command: 'npm run server',
    url: 'http://127.0.0.1:4173/api/health',
    env: {
      PORT: '4173',
      TEMPO_FEED_HOST: '127.0.0.1',
      TEMPO_FEED_DIR: resolve('test-results/subscriptions'),
      TEMPO_STATIC_DIR: resolve('dist'),
    },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

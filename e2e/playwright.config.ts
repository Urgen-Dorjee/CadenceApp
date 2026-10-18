import { defineConfig } from '@playwright/test'

// UI smoke tests: the built app (npm run build:frontend), started by Playwright with a fresh,
// temporary data folder. No network is used: the media is made with FFmpeg on the spot.
export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../e2e-report' }]] : 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  outputDir: '../e2e-results',
})

import { defineConfig } from '@playwright/test'

// UI smoke tests: the built app (npm run build:frontend), started by Playwright with a fresh,
// temporary data folder. No network is used: the media is made with FFmpeg on the spot.
export default defineConfig({
  testDir: '.',
  // Website screenshots are made on request only: SCREENSHOTS=1 npx playwright test screenshots
  testIgnore: process.env.SCREENSHOTS ? [] : ['screenshots.spec.ts'],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../e2e-report' }]] : 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  outputDir: '../e2e-results',
})

import { defineConfig } from '@playwright/test'

// The fidelity shots of the redesign (D-81): one worker, because the sample agency is seeded once
// and both sizes are taken from it. Not part of CI: `pnpm --filter @app/web design:shots [NN …]`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH

export default defineConfig({
  testDir: '.',
  testMatch: 'shots.spec.ts',
  globalSetup: '../e2e/global-setup.ts',
  workers: 1,
  timeout: 300_000,
  reporter: 'list',
  use: {
    colorScheme: 'light',
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    launchOptions: executablePath ? { executablePath } : {},
  },
})

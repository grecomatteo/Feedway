import { defineConfig } from '@playwright/test'

// The fidelity shots of the redesign (D-81): one worker, because the sample agency is seeded once
// and both sizes are taken from it. Not part of CI: `pnpm --filter @app/web design:shots [NN …]`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH

export default defineConfig({
  testDir: '.',
  testMatch: /(shots|states)\.spec\.ts/,
  globalSetup: '../e2e/global-setup.ts',
  workers: 1,
  timeout: 1_200_000,
  reporter: 'list',
  use: {
    colorScheme: 'light',
    // a step that cannot happen fails in seconds, not at the end of the whole run
    actionTimeout: 20_000,
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    launchOptions: executablePath ? { executablePath } : {},
  },
})

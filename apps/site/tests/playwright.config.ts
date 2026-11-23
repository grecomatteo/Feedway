import { defineConfig, devices } from '@playwright/test'

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
const launchOptions = executablePath ? { executablePath } : {}

// Runs on the output of `pnpm --filter @app/site generate`.
export default defineConfig({
  testDir: '.',
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: 'http://127.0.0.1:3102' },
  webServer: {
    command: 'node serve.mjs',
    url: 'http://127.0.0.1:3102/',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions } },
  ],
})

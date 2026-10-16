import { defineConfig, devices } from '@playwright/test'

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
const launchOptions = executablePath ? { executablePath } : {}

const project = (
  name: string,
  device: (typeof devices)[string],
  colorScheme: 'light' | 'dark',
) => ({
  name,
  use: { ...device, colorScheme, launchOptions },
})

export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  projects: [
    project('desktop-light', devices['Desktop Chrome'], 'light'),
    project('desktop-dark', devices['Desktop Chrome'], 'dark'),
    project('mobile-light', devices['Pixel 7'], 'light'),
    project('mobile-dark', devices['Pixel 7'], 'dark'),
  ],
})

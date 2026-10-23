import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{apps,packages,tools}/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/*.int.test.ts', '**/tests/e2e/**'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['{apps,packages,tools}/**/*.int.test.ts'],
          exclude: ['**/node_modules/**'],
          globalSetup: ['apps/web/tests/api/global-setup.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
})

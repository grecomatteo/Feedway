import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        // apps/web/tsconfig.json only references files that `nuxt prepare` generates, and the
        // unit job does not run it: every package tsconfig extends the base without changing
        // what the transform reads, so the base is used for all unit files
        tsconfig: './tsconfig.base.json',
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

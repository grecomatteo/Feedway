// Bundles the worker, the healthcheck and the migrate command into dist/ with esbuild.
// Workspace packages (@app/*) are inlined because they are TypeScript sources; every other
// dependency stays external and is resolved from node_modules at runtime.
import { cpSync, rmSync } from 'node:fs'
import { build } from 'esbuild'

rmSync('dist', { recursive: true, force: true })

await build({
  entryPoints: ['src/main.ts', 'src/healthcheck.ts', 'src/migrate.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  plugins: [
    {
      name: 'external-dependencies',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith('@app/') || args.path.startsWith('node:')
            ? undefined
            : { path: args.path, external: true },
        )
      },
    },
  ],
})

// runMigrations reads the SQL files next to the bundle
cpSync('../../packages/infrastructure/src/db/migrations', 'dist/migrations', { recursive: true })
// the email texts live with the panel's: src/i18n.ts reads this copy in the image
cpSync('../web/i18n/locales/it.json', 'dist/locales/it.json')

// `pnpm --filter @app/web design:shots [NN …]`: the fidelity shots of the given screens (all when
// none), see shots.spec.ts. The numbers go to the spec through DESIGN_SHOTS.
import { spawnSync } from 'node:child_process'

const numbers = process.argv.slice(2).join(' ')
const run = spawnSync(
  'pnpm',
  ['exec', 'playwright', 'test', '-c', 'tests/design/playwright.config.ts', '--trace', 'off'],
  { stdio: 'inherit', env: { ...process.env, DESIGN_SHOTS: numbers } },
)
process.exit(run.status ?? 1)

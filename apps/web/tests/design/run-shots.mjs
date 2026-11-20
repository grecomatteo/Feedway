// `pnpm --filter @app/web design:shots [NN …]`: the fidelity shots of the given screens (all when
// none), see shots.spec.ts. The numbers go to the spec through DESIGN_SHOTS.
// `design:states` (--states) takes the empty, loading and failed states instead, see states.spec.ts.
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const states = args.includes('--states')
const numbers = args.filter((a) => a !== '--states').join(' ')
const spec = states ? 'states.spec.ts' : 'shots.spec.ts'
const run = spawnSync(
  'pnpm',
  ['exec', 'playwright', 'test', '-c', 'tests/design/playwright.config.ts', spec, '--trace', 'off'],
  { stdio: 'inherit', env: { ...process.env, DESIGN_SHOTS: numbers } },
)
process.exit(run.status ?? 1)

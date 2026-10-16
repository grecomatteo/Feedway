import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

export interface DepcruiseResult {
  exitCode: number
  violatedRules: string[]
}

interface Report {
  summary: { violations: { rule: { name: string; severity: string } }[] }
}

/** Runs dependency-cruiser from the repo root on the given paths (space separated). */
export function runDepcruise(paths: string): DepcruiseResult {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'depcruise',
      '--config',
      '.dependency-cruiser.cjs',
      '--output-type',
      'json',
      ...paths.split(' '),
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  const report = JSON.parse(result.stdout) as Report
  const names = report.summary.violations.map((v) => v.rule.name)
  // json output always exits 0, so derive the exit code from error-level violations
  const failed = report.summary.violations.some((v) => v.rule.severity === 'error')
  return { exitCode: failed ? 1 : (result.status ?? 1), violatedRules: [...new Set(names)] }
}

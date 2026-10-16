import { expect, test } from 'vitest'
import { runDepcruise } from './run.js'

test.each([
  ['domain-imports-infra', 'domain-no-outside'],
  ['application-imports-pg', 'application-only-domain-and-zod'],
  ['package-imports-app', 'packages-never-import-apps'],
  ['module-imports-internals', 'modules-only-through-public-index'],
])('fixture %s violates rule %s', (fixture, rule) => {
  const result = runDepcruise(`tools/arch-fixtures/${fixture}`)
  expect(result.exitCode).not.toBe(0)
  expect(result.violatedRules).toContain(rule)
})

test('real codebase has no violations', () => {
  expect(runDepcruise('apps packages').exitCode).toBe(0)
})

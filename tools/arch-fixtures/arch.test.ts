import { expect, test } from 'vitest'
import { runDepcruise } from './run.js'

test.each([
  ['domain-imports-infra', 'domain-no-outside'],
  ['application-imports-pg', 'application-only-domain-and-zod'],
  ['package-imports-app', 'packages-never-import-apps'],
  ['module-imports-internals', 'modules-only-through-public-index'],
  ['db-repository-imports-other-tables', 'db-modules-not-across-tables'],
  ['db-nested-schema-imports-other-tables', 'db-modules-not-across-tables'],
  ['db-schema-imports-other-repository', 'db-schemas-only-reference-schemas'],
  ['db-aggregator-imports-repository', 'db-aggregator-only-schemas'],
  ['module-imports-better-auth', 'better-auth-only-in-adapter'],
  ['infrastructure-imports-resolved-better-auth', 'better-auth-only-in-adapter'],
  ['db-module-imports-identity', 'identity-tables-only-from-identity'],
])('fixture %s violates rule %s', (fixture, rule) => {
  const result = runDepcruise(`tools/arch-fixtures/${fixture}`)
  expect(result.exitCode).not.toBe(0)
  expect(result.violatedRules).toContain(rule)
})

test('a db schema may import another module schema for foreign keys', () => {
  const { violatedRules } = runDepcruise('tools/arch-fixtures/db-schema-imports-other-schema')
  // the same import from a repository is caught (fixture db-repository-imports-other-tables),
  // so an empty result here means the exception works, not that nothing was cruised
  expect(violatedRules.filter((r) => r.startsWith('db-'))).toEqual([])
})

test('real codebase has no violations', () => {
  expect(runDepcruise('apps packages').exitCode).toBe(0)
})

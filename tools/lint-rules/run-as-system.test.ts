import { expect, test } from 'vitest'
import { lintSnippet } from './lint-snippet.js'

const header = 'interface Uow { runAsSystem(reason: string): void; run(scope: object): void }\n'
const call = `${header}export function go(uow: Uow): void { uow.runAsSystem('x') }\n`
const restricted: unknown = expect.objectContaining({ ruleId: 'no-restricted-properties' })

test.each([
  'packages/application/src/workspaces/workspaces.ts',
  'packages/application/src/identity/profile.ts',
  'apps/web/server/api/v1/workspaces.get.ts',
  'apps/worker/src/handlers/some-job.ts',
])('runAsSystem is rejected in %s', async (file) => {
  expect(await lintSnippet(call, file)).toContainEqual(restricted)
})

test.each([
  ['optional chaining', "export function go(uow?: Uow): void { uow?.runAsSystem('x') }"],
  ['bracket access', "export function go(uow: Uow): void { uow['runAsSystem']('x') }"],
  [
    'destructuring',
    "export function go(uow: Uow): void { const { runAsSystem } = uow; runAsSystem.call(uow, 'x') }",
  ],
  ['destructured parameter', "export function go({ runAsSystem }: Uow): void { runAsSystem('x') }"],
])('runAsSystem through %s is rejected too', async (_name, body) => {
  const messages = await lintSnippet(
    `${header}${body}\n`,
    'packages/application/src/workspaces/workspaces.ts',
  )
  expect(messages).toContainEqual(restricted)
})

test.each([
  'packages/application/src/identity/retention.ts',
  'packages/application/src/identity/activation.ts',
  'packages/application/src/platform/organizations.ts',
  'packages/application/src/workspaces/workspaces.int.test.ts',
])('runAsSystem is allowed in %s', async (file) => {
  expect(await lintSnippet(call, file)).toEqual([])
})

test('the rule names the property, not every call', async () => {
  const messages = await lintSnippet(
    `${header}export function go(uow: Uow): void { uow.run({}) }\n`,
    'packages/application/src/workspaces/workspaces.ts',
  )
  expect(messages).toEqual([])
})

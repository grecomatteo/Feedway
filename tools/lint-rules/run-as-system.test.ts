import { expect, test } from 'vitest'
import { lintSnippet } from './lint-snippet.js'

const snippet = "export const go = (uow: any, fn: any) => uow.runAsSystem('x', fn)\n"
const restricted: unknown = expect.objectContaining({ ruleId: 'no-restricted-properties' })

test.each([
  'packages/application/src/workspaces/workspaces.ts',
  'packages/application/src/identity/profile.ts',
  'apps/web/server/api/v1/workspaces.get.ts',
  'apps/worker/src/handlers/some-job.ts',
])('runAsSystem is rejected in %s', async (file) => {
  expect(await lintSnippet(snippet, file)).toContainEqual(restricted)
})

test.each([
  'packages/application/src/identity/retention.ts',
  'packages/application/src/identity/activation.ts',
  'packages/application/src/platform/organizations.ts',
  'packages/application/src/workspaces/workspaces.int.test.ts',
])('runAsSystem is allowed in %s', async (file) => {
  expect(await lintSnippet(snippet, file)).not.toContainEqual(restricted)
})

test('the rule names the property, not every call', async () => {
  const messages = await lintSnippet(
    "export const go = (uow: any, fn: any) => uow.run({ userId: 'u' }, fn)\n",
    'packages/application/src/workspaces/workspaces.ts',
  )
  expect(messages).not.toContainEqual(restricted)
})

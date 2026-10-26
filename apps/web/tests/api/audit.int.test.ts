import { afterAll, beforeAll, expect, test } from 'vitest'
import { startApiEnv } from './identity-env.js'
import type { ApiEnv } from './identity-env.js'

let env: ApiEnv

beforeAll(async () => {
  env = await startApiEnv('audit')
}, 300_000)

afterAll(async () => {
  await env.stop()
})

interface AuditPage {
  items: Record<string, unknown>[]
  nextCursor: string | null
}

test('the activity log answers pages of the agency, without addresses', async () => {
  const agency = await env.agency()
  const owner = await env.person(agency.id, 'owner', { name: 'Olga Owner' })
  const member = await env.person(agency.id, 'member')
  const cookie = await env.strongSignIn(owner)
  const base = `/api/v1/orgs/${agency.slug}`
  for (const name of ['Uno', 'Due', 'Tre'])
    expect((await env.call('POST', `${base}/workspaces`, { name }, { cookie })).status).toBe(200)

  const first = await env.call('GET', `${base}/audit-log?limit=2`, undefined, { cookie })
  expect(first.status).toBe(200)
  const page = (await first.json()) as AuditPage
  expect(page.items).toHaveLength(2)
  expect(page.nextCursor).toEqual(expect.any(String))
  for (const item of page.items) {
    expect(item).not.toHaveProperty('ip')
    expect(item).toMatchObject({
      organizationId: agency.id,
      actorId: owner.userId,
      authorName: 'Olga Owner',
      action: 'workspace.created',
      source: 'panel',
    })
  }
  const next = await env.call(
    'GET',
    `${base}/audit-log?limit=2&cursor=${String(page.nextCursor)}`,
    undefined,
    { cookie },
  )
  expect(((await next.json()) as AuditPage).items).toHaveLength(1)

  const filtered = await env.call('GET', `${base}/audit-log?action=workspace.renamed`, undefined, {
    cookie,
  })
  expect(await filtered.json()).toEqual({ items: [], nextCursor: null })

  for (const bad of [
    'limit=0',
    'limit=101',
    'cursor=nonvalido',
    'action=inventata',
    'from=ieri',
    'organizationId=x',
    'limit=1&limit=2',
  ])
    expect(
      (await env.call('GET', `${base}/audit-log?${bad}`, undefined, { cookie })).status,
      bad,
    ).toBe(422)

  const memberCookie = await env.signIn(member)
  expect(
    (await env.call('GET', `${base}/audit-log`, undefined, { cookie: memberCookie })).status,
  ).toBe(403)
  const other = await env.agency()
  expect(
    (await env.call('GET', `/api/v1/orgs/${other.slug}/audit-log`, undefined, { cookie })).status,
  ).toBe(404)
})

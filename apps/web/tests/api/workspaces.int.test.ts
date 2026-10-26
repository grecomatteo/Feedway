import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { seed } from '@app/infrastructure/testing'
import { errorCodeOf, startApiEnv } from './identity-env.js'
import type { ApiEnv } from './identity-env.js'

let env: ApiEnv

beforeAll(async () => {
  env = await startApiEnv('spaces')
}, 300_000)

afterAll(async () => {
  await env.stop()
})

interface WorkspaceJson {
  id: string
  name: string
  slug: string
  archivedAt: string | null
  myRole: string
}

test('Owner creates, lists, renames and archives workspaces', async () => {
  const agency = await env.agency()
  const owner = await env.person(agency.id, 'owner')
  const cookie = await env.strongSignIn(owner)
  const base = `/api/v1/orgs/${agency.slug}/workspaces`

  const created = await env.call('POST', base, { name: 'Clienti Nord' }, { cookie })
  expect(created.status).toBe(200)
  const ws = (await created.json()) as WorkspaceJson
  expect(Object.keys(ws).sort()).toEqual(['archivedAt', 'id', 'myRole', 'name', 'slug'])
  expect(ws).toMatchObject({ name: 'Clienti Nord', archivedAt: null, myRole: 'owner' })
  expect(
    (await env.call('POST', base, { name: 'X', organizationId: randomUUID() }, { cookie })).status,
  ).toBe(422)

  const list = await env.call('GET', base, undefined, { cookie })
  expect(list.status).toBe(200)
  expect(((await list.json()) as { items: WorkspaceJson[] }).items.map((w) => w.id)).toEqual([
    ws.id,
  ])

  const renamed = await env.call('PATCH', `${base}/${ws.id}`, { name: 'Clienti Sud' }, { cookie })
  expect(renamed.status).toBe(200)
  expect(await renamed.json()).toMatchObject({ id: ws.id, name: 'Clienti Sud' })

  const archived = await env.call('POST', `${base}/${ws.id}/archive`, undefined, { cookie })
  expect(archived.status).toBe(200)
  expect(await archived.json()).toEqual({ archived: true })

  // IDOR: a workspace of another agency is not found through this one
  const other = await env.agency()
  const foreign = await seed(env.tdb.runtimeUrl, (s) => s.workspace(other.id))
  expect(
    (await env.call('PATCH', `${base}/${foreign}`, { name: 'Preso' }, { cookie })).status,
  ).toBe(404)
  expect((await env.call('GET', `${base}/${foreign}/members`, undefined, { cookie })).status).toBe(
    404,
  )
})

test('workspace members: adding and changing a role need a reauth and sign the person out', async () => {
  const agency = await env.agency()
  const owner = await env.person(agency.id, 'owner')
  const person = await env.person(agency.id, 'member')
  const workspaceId = await seed(env.tdb.runtimeUrl, (s) => s.workspace(agency.id))
  const cookie = await env.strongSignIn(owner)
  const members = `/api/v1/orgs/${agency.slug}/workspaces/${workspaceId}/members`

  const stale = await env.call(
    'POST',
    members,
    { userId: person.userId, role: 'editor' },
    { cookie },
  )
  expect(stale.status).toBe(403)
  expect(await errorCodeOf(stale)).toBe('REAUTH_REQUIRED')

  await env.reauth(cookie)
  let personCookie = await env.signIn(person)
  const added = await env.call(
    'POST',
    members,
    { userId: person.userId, role: 'editor' },
    { cookie },
  )
  expect(added.status).toBe(200)
  expect(await added.json()).toEqual({ role: 'editor' })
  expect((await env.call('GET', '/api/v1/me', undefined, { cookie: personCookie })).status).toBe(
    401,
  )

  // everyone in the workspace sees who works there, without emails
  personCookie = await env.signIn(person)
  const listed = await env.call('GET', members, undefined, { cookie: personCookie })
  expect(listed.status).toBe(200)
  const { items } = (await listed.json()) as { items: Record<string, unknown>[] }
  expect(items).toHaveLength(1)
  expect(Object.keys(items[0] ?? {}).sort()).toEqual(
    ['avatarUrl', 'displayName', 'role', 'status', 'userId'].sort(),
  )
  // an editor does not manage members
  expect(
    (
      await env.call(
        'PUT',
        `${members}/${person.userId}`,
        { role: 'manager' },
        {
          cookie: personCookie,
        },
      )
    ).status,
  ).toBe(403)

  const changed = await env.call(
    'PUT',
    `${members}/${person.userId}`,
    { role: 'viewer' },
    { cookie },
  )
  expect(changed.status).toBe(200)
  expect(await changed.json()).toEqual({ role: 'viewer' })
  expect((await env.call('GET', '/api/v1/me', undefined, { cookie: personCookie })).status).toBe(
    401,
  )

  // someone of another agency is not found, as anyone outside it
  const other = await env.agency()
  const stranger = await env.person(other.id, 'member')
  expect(
    (await env.call('POST', members, { userId: stranger.userId, role: 'viewer' }, { cookie }))
      .status,
  ).toBe(404)

  const removed = await env.call('DELETE', `${members}/${person.userId}`, undefined, { cookie })
  expect(removed.status).toBe(200)
  expect(await removed.json()).toEqual({ removed: true })
  expect(
    (await env.call('DELETE', `${members}/${person.userId}`, undefined, { cookie })).status,
  ).toBe(404)
})

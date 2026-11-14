import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { seed } from '@app/infrastructure/testing'
import { startApiEnv } from './identity-env.js'
import type { ApiEnv, Person } from './identity-env.js'

// «Clienti» (plan 04 Task 5b, spec §14.7): every row of the list carries the profiles of the
// client and the state of their link, only among the accounts the person may see.

let env: ApiEnv
let org: { id: string; slug: string }
let owner: Person, member: Person
const cookies = { owner: '', member: '' }
let forno: string, gino: string, empty: string
let fornoIg: string, fornoPage: string, ginoIg: string, ginoPageElsewhere: string, gone: string

async function connection(status: 'active' | 'expired'): Promise<string> {
  const id = randomUUID()
  await env.admin.pool.query(
    `insert into account_connections (id, organization_id, kind, external_user_id, connected_by,
                                      token_enc, key_version, status)
     values ($1, $2, 'meta_system_user', $3, $4, 'v1.sealed', 1, $5)`,
    [id, org.id, randomUUID(), owner.userId, status],
  )
  return id
}

async function account(
  connectionId: string,
  opts: {
    platform: 'instagram' | 'facebook'
    name: string
    username?: string
    pageId: string
    health?: 'ok' | 'warning' | 'error'
    active?: boolean
  },
): Promise<string> {
  const id = randomUUID()
  const externalId = opts.platform === 'facebook' ? opts.pageId : `17${randomUUID().slice(0, 12)}`
  await env.admin.pool.query(
    `insert into social_accounts (id, organization_id, platform, external_id, name, username,
                                  page_id, connection_id, health, active)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      org.id,
      opts.platform,
      externalId,
      opts.name,
      opts.username ?? null,
      opts.pageId,
      connectionId,
      opts.health ?? 'ok',
      opts.active ?? true,
    ],
  )
  return id
}

async function assign(workspaceId: string, accountId: string) {
  await env.admin.pool.query(
    'insert into workspace_accounts (organization_id, workspace_id, account_id) values ($1, $2, $3)',
    [org.id, workspaceId, accountId],
  )
}

beforeAll(async () => {
  env = await startApiEnv('workspace-profiles')
  org = await env.agency()
  owner = await env.person(org.id, 'owner')
  member = await env.person(org.id, 'member')
  ;({ forno, gino, empty } = await seed(env.tdb.runtimeUrl, async (s) => {
    const f = await s.workspace(org.id, { name: 'Forno Luce' })
    const g = await s.workspace(org.id, { name: 'Pizzeria Da Gino' })
    const e = await s.workspace(org.id, { name: 'Bottega' })
    await s.workspaceMember(org.id, f, member.userId, 'editor')
    return { forno: f, gino: g, empty: e }
  }))
  const working = await connection('active')
  const broken = await connection('expired')
  fornoPage = await account(working, { platform: 'facebook', name: 'Forno Luce', pageId: 'p-1' })
  fornoIg = await account(working, {
    platform: 'instagram',
    name: 'Forno Luce',
    username: 'forno.luce',
    pageId: 'p-1',
    health: 'warning',
  })
  gone = await account(working, {
    platform: 'instagram',
    name: 'Vecchio profilo',
    username: 'vecchio',
    pageId: 'p-9',
    active: false,
  })
  ginoIg = await account(broken, {
    platform: 'instagram',
    name: 'Da Gino',
    username: 'dagino',
    pageId: 'p-2',
  })
  // the Page of Gino's pair sits in another client: Gino's row never names it
  ginoPageElsewhere = await account(broken, {
    platform: 'facebook',
    name: 'Pagina di Gino',
    pageId: 'p-2',
  })
  for (const id of [fornoPage, fornoIg, gone]) await assign(forno, id)
  await assign(gino, ginoIg)
  await assign(forno, ginoPageElsewhere)
  await env.addPasskey(owner.userId)
  cookies.owner = await env.strongSignIn(owner)
  cookies.member = await env.signIn(member)
}, 300_000)

afterAll(async () => {
  await env.stop()
})

interface Row {
  id: string
  profiles: {
    key: string
    link: string
    accounts: { id: string; platform: string; name: string; username: string | null }[]
  }[]
}
async function rows(cookie: string): Promise<{ text: string; items: Row[] }> {
  const r = await env.call('GET', `/api/v1/orgs/${org.slug}/workspaces`, undefined, { cookie })
  const text = await r.text()
  expect(r.status, text).toBe(200)
  return { text, items: (JSON.parse(text) as { items: Row[] }).items }
}

test('every client carries its profiles, Instagram first, and the state of their link', async () => {
  const { items } = await rows(cookies.owner)
  const of = (id: string) => items.find((w) => w.id === id)?.profiles
  expect(of(forno)).toEqual([
    {
      key: 'page:p-1',
      link: 'warning',
      accounts: [
        expect.objectContaining({ id: fornoIg, platform: 'instagram', username: 'forno.luce' }),
        expect.objectContaining({ id: fornoPage, platform: 'facebook', name: 'Forno Luce' }),
      ],
    },
    {
      key: 'page:p-2',
      link: 'reconnect',
      accounts: [expect.objectContaining({ id: ginoPageElsewhere, platform: 'facebook' })],
    },
  ])
  expect(of(gino)).toEqual([
    {
      key: 'page:p-2',
      link: 'reconnect',
      accounts: [expect.objectContaining({ id: ginoIg, name: 'Da Gino' })],
    },
  ])
  expect(of(empty)).toEqual([])
})

test('an inactive account is no profile of the client', async () => {
  const { text } = await rows(cookies.owner)
  expect(text).not.toContain(gone)
  expect(text).not.toContain('Vecchio profilo')
})

test('a Member sees only the profiles of their clients, and nothing of the connection', async () => {
  const { text, items } = await rows(cookies.member)
  expect(items.map((w) => w.id)).toEqual([forno])
  // the state of the link is shown to everyone; the connection itself is not
  expect(items[0]?.profiles.map((p) => p.link)).toEqual(['warning', 'reconnect'])
  expect(text).not.toContain(ginoIg)
  expect(text).not.toContain('dagino')
  expect(text).not.toMatch(/connection|token|expired/i)
})

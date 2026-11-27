import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { seed } from '@app/infrastructure/testing'
import { startApiEnv } from './identity-env.js'
import type { ApiEnv, ErrorJson, Person } from './identity-env.js'

// Instagram's collaborators over HTTP (plan 09 Task 15, D-125): the editor saves the names as
// typed, the checks block what Instagram would refuse, the page of the outcome tells each
// invitation, and «Aggiorna» asks the worker to read the answers again, never Meta.

let env: ApiEnv
let org: { id: string; slug: string }
let editor: Person, viewer: Person
const cookies = {} as Record<'editor' | 'viewer', string>
let forno: string, igForno: string, fbForno: string

async function call(
  who: 'editor' | 'viewer',
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
) {
  const r = await env.call(method, `/api/v1/orgs/${org.slug}${path}`, body, {
    cookie: cookies[who],
  })
  const text = await r.text()
  return { status: r.status, json: (text ? JSON.parse(text) : null) as unknown }
}

const posts = () => `/workspaces/${forno}/posts`

beforeAll(async () => {
  env = await startApiEnv('collaborators')
  org = await env.agency()
  editor = await env.person(org.id, 'member')
  viewer = await env.person(org.id, 'member')
  ;({ forno, igForno, fbForno } = await seed(env.tdb.runtimeUrl, async (s) => {
    const f = await s.workspace(org.id, { name: 'Forno Luce' })
    await s.workspaceMember(org.id, f, editor.userId, 'editor')
    await s.workspaceMember(org.id, f, viewer.userId, 'viewer')
    return {
      forno: f,
      igForno: await s.account(org.id, { platform: 'instagram', workspaceIds: [f] }),
      fbForno: await s.account(org.id, { platform: 'facebook', workspaceIds: [f] }),
    }
  }))
  cookies.editor = await env.signIn(editor)
  cookies.viewer = await env.signIn(viewer)
}, 300_000)

afterAll(async () => {
  await env.stop()
})

test('a draft saves the collaborators as typed, and a save changes them', async () => {
  const created = await call('editor', 'POST', posts(), {
    type: 'photo',
    instagramCollaborators: ['forno.luce', '@mulino'],
  })
  expect(created.status, JSON.stringify(created.json)).toBe(200)
  const draft = created.json as { id: string; version: number; instagramCollaborators: string[] }
  expect(draft.instagramCollaborators).toEqual(['forno.luce', '@mulino'])
  const saved = await call('editor', 'PATCH', `${posts()}/${draft.id}`, {
    version: draft.version,
    instagramCollaborators: ['mulino'],
  })
  expect((saved.json as { instagramCollaborators: string[] }).instagramCollaborators).toEqual([
    'mulino',
  ])
  // a save that does not name them keeps them
  const caption = await call('editor', 'PATCH', `${posts()}/${draft.id}`, {
    version: (saved.json as { version: number }).version,
    caption: { common: 'Pane' },
  })
  expect((caption.json as { instagramCollaborators: string[] }).instagramCollaborators).toEqual([
    'mulino',
  ])
  // more than the column takes is a wrong body
  const many = await call('editor', 'POST', posts(), {
    type: 'photo',
    instagramCollaborators: Array.from({ length: 11 }, (_, i) => `nome${String(i)}`),
  })
  expect(many.status).toBe(422)
})

test('the server repeats the checks: 4 names block, without Instagram they warn', async () => {
  const check = async (names: string[], accounts = [igForno, fbForno]) => {
    const r = await call('editor', 'POST', `/workspaces/${forno}/post-checks`, {
      type: 'photo',
      mediaIds: [],
      caption: { common: 'Pane' },
      destinations: accounts.map((accountId) => ({ accountId })),
      when: { mode: 'now' },
      choices: [],
      instagramCollaborators: names,
    })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    return (r.json as { outcomes: { code: string; level: string }[] }).outcomes
      .filter((o) => o.code.startsWith('collaborator'))
      .map((o) => `${o.level} ${o.code}`)
  }
  expect(await check(['uno', 'due', 'tre'])).toEqual([])
  expect(await check(['uno', 'due', 'tre', 'quattro'])).toEqual(['block collaborators_too_many'])
  expect(await check(['forno'], [fbForno])).toEqual(['warning collaborators_without_instagram'])
})

/** A post out on Instagram with an invitation the worker sent. */
async function publishedWithInvitation(dropped = false): Promise<string> {
  const id = randomUUID()
  await env.admin.pool.query(
    `insert into posts (id, organization_id, workspace_id, type, caption, status, scheduled_at,
                        options, instagram_collaborators, created_by, updated_by)
     values ($1, $2, $3, 'photo', 'Pane', 'published', now(), '{"shareToFeed":true,"choices":[]}',
             '{forno.luce}', $4, $4)`,
    [id, org.id, forno, editor.userId],
  )
  await env.admin.pool.query(
    `insert into post_targets (id, organization_id, workspace_id, post_id, account_id, status,
                               external_post_id, meta_ids, published_at)
     values ($1, $2, $3, $4, $5, 'confirmed', '17890000000000001', $6, now())`,
    [
      randomUUID(),
      org.id,
      forno,
      id,
      igForno,
      JSON.stringify({
        platform: 'instagram',
        collaborators: {
          names: ['forno.luce'],
          dropped: dropped ? { platformCode: '100' } : null,
        },
      }),
    ],
  )
  return id
}

test('the outcome tells each invitation, and «Aggiorna» asks the worker to read it', async () => {
  const postId = await publishedWithInvitation()
  const outcome = await call('viewer', 'GET', `${posts()}/${postId}/outcome?preview=0`)
  expect(outcome.status).toBe(200)
  const [destination] = (outcome.json as { destinations: { collaborators: unknown }[] })
    .destinations
  expect(destination?.collaborators).toEqual({
    people: [{ username: 'forno.luce', status: 'waiting' }],
    notSentCode: null,
    readAt: null,
  })
  const before = await env.admin.pool.query(
    "select count(*)::int as n from pgboss.job where name = 'posts.collaborators_refresh'",
  )
  const refresh = await call('viewer', 'POST', `${posts()}/${postId}/collaborators/refresh`)
  expect(refresh.status, JSON.stringify(refresh.json)).toBe(200)
  expect(refresh.json).toEqual({ queued: true })
  const after = await env.admin.pool.query<{ n: number; data: unknown }>(
    `select count(*)::int as n, max(data::text) as data from pgboss.job
      where name = 'posts.collaborators_refresh'`,
  )
  expect(after.rows[0]?.n).toBe((before.rows[0] as { n: number }).n + 1)
  expect(JSON.parse(String(after.rows[0]?.data))).toEqual({ organizationId: org.id, postId })
})

test('nothing went out to be read: «Aggiorna» is 409', async () => {
  const dropped = await publishedWithInvitation(true)
  const r = await call('editor', 'POST', `${posts()}/${dropped}/collaborators/refresh`)
  expect(r.status).toBe(409)
  expect((r.json as ErrorJson).error.code).toBe('CONFLICT')
  const outcome = await call('editor', 'GET', `${posts()}/${dropped}/outcome?preview=0`)
  expect(
    (outcome.json as { destinations: { collaborators: unknown }[] }).destinations[0]?.collaborators,
  ).toEqual({
    people: [{ username: 'forno.luce', status: 'not_sent' }],
    notSentCode: '100',
    readAt: null,
  })
})

test('«Duplica» copies the collaborators', async () => {
  const created = await call('editor', 'POST', posts(), {
    type: 'photo',
    instagramCollaborators: ['forno.luce'],
  })
  const source = (created.json as { id: string }).id
  const copies = await call('editor', 'POST', `${posts()}/${source}/duplicate`, {
    dates: [{ localDate: '2027-03-01', localTime: '12:30' }],
    schedule: false,
  })
  expect(copies.status, JSON.stringify(copies.json)).toBe(200)
  const [row] = (copies.json as { rows: { postId: string | null }[] }).rows
  const copy = await call('editor', 'GET', `${posts()}/${row?.postId ?? ''}`)
  expect((copy.json as { instagramCollaborators: string[] }).instagramCollaborators).toEqual([
    'forno.luce',
  ])
})

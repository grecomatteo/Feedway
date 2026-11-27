import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { seed } from '@app/infrastructure/testing'
import { startApiEnv } from './identity-env.js'
import type { ApiEnv, ErrorJson, Person } from './identity-env.js'

// «Eliminati» over HTTP (plan 09 Task 14, Scelta 12): «Elimina» sends drafts and cancelled posts
// to the client's «Eliminati», all or none; «Ripristina» gives them back as they were; nothing
// else writes them; no read but «Eliminati» shows them; «Elimina per sempre» and «Svuota» delete
// them, and the plan's content of a post deleted for good is to prepare again.

let env: ApiEnv
let org: { id: string; slug: string }
const people = {} as Record<'owner' | 'manager' | 'editor' | 'viewer', Person>
const cookies = {} as Record<keyof typeof people, string>
let forno: string, archived: string, igForno: string

type Who = keyof typeof people

async function call(
  who: Who,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
) {
  const r = await env.call(method, `/api/v1/orgs/${org.slug}${path}`, body, {
    cookie: cookies[who],
  })
  const text = await r.text()
  return { status: r.status, json: (text ? JSON.parse(text) : null) as unknown }
}

const posts = (workspaceId = forno) => `/workspaces/${workspaceId}/posts`

async function post(
  opts: {
    workspaceId?: string
    status?: 'draft' | 'scheduled' | 'cancelled'
    when?: Date | null
    caption?: string
    author?: string
    trashed?: boolean
  } = {},
): Promise<string> {
  const id = randomUUID()
  const workspaceId = opts.workspaceId ?? forno
  const author = opts.author ?? people.editor.userId
  await env.admin.pool.query(
    `insert into posts (id, organization_id, workspace_id, type, caption, status, scheduled_at,
                        options, created_by, updated_by, trashed_at)
     values ($1, $2, $3, 'photo', $4, $5, $6, '{"shareToFeed":true,"choices":[]}', $7, $7,
             case when $8 then now() end)`,
    [
      id,
      org.id,
      workspaceId,
      opts.caption ?? 'Il pane di oggi',
      opts.status ?? 'draft',
      opts.when === undefined ? new Date('2027-01-14T10:00:00Z') : opts.when,
      author,
      opts.trashed ?? false,
    ],
  )
  if (opts.status === 'scheduled')
    await env.admin.pool.query(
      `insert into post_targets (id, organization_id, workspace_id, post_id, account_id, status)
       values ($1, $2, $3, $4, $5, 'scheduled')`,
      [randomUUID(), org.id, workspaceId, id, igForno],
    )
  return id
}

const row = async (id: string) =>
  (
    await env.admin.pool.query<{ status: string; trashed: boolean; version: number }>(
      'select status, trashed_at is not null as trashed, version from posts where id = $1',
      [id],
    )
  ).rows[0] ?? null

const errorOf = (r: { json: unknown }) => (r.json as ErrorJson).error

beforeAll(async () => {
  env = await startApiEnv('trash')
  org = await env.agency()
  people.owner = await env.person(org.id, 'owner')
  people.manager = await env.person(org.id, 'member')
  people.editor = await env.person(org.id, 'member')
  people.viewer = await env.person(org.id, 'member')
  ;({ forno, archived, igForno } = await seed(env.tdb.runtimeUrl, async (s) => {
    const f = await s.workspace(org.id, { name: 'Forno Luce' })
    const a = await s.workspace(org.id, { name: 'Vecchio cliente', archived: true })
    for (const w of [f, a]) {
      await s.workspaceMember(org.id, w, people.manager.userId, 'manager')
      await s.workspaceMember(org.id, w, people.editor.userId, 'editor')
      await s.workspaceMember(org.id, w, people.viewer.userId, 'viewer')
    }
    return {
      forno: f,
      archived: a,
      igForno: await s.account(org.id, { platform: 'instagram', workspaceIds: [f] }),
    }
  }))
  await env.addPasskey(people.owner.userId)
  cookies.owner = await env.strongSignIn(people.owner)
  cookies.manager = await env.signIn(people.manager)
  cookies.editor = await env.signIn(people.editor)
  cookies.viewer = await env.signIn(people.viewer)
}, 300_000)

afterAll(async () => {
  await env.stop()
})

describe('«Elimina» goes to «Eliminati», all or none', () => {
  test('ten drafts, one someone else’s: the Editor gets 403 and none moves', async () => {
    const mine = await Promise.all(Array.from({ length: 9 }, () => post()))
    const theirs = await post({ author: people.manager.userId })
    const r = await call('editor', 'POST', `${posts()}/trash`, { postIds: [...mine, theirs] })
    expect(r.status, JSON.stringify(r.json)).toBe(403)
    for (const id of [...mine, theirs]) expect((await row(id))?.trashed).toBe(false)
    // the Manager may change anyone's: all ten go
    const ok = await call('manager', 'POST', `${posts()}/trash`, { postIds: [...mine, theirs] })
    expect(ok.status, JSON.stringify(ok.json)).toBe(200)
    expect((ok.json as { postIds: string[] }).postIds).toHaveLength(10)
    for (const id of [...mine, theirs])
      expect(await row(id)).toMatchObject({ status: 'draft', trashed: true })
  })

  test('a scheduled post among them: 409 and none moves; a cancelled one goes', async () => {
    const draft = await post()
    const scheduled = await post({ status: 'scheduled' })
    const r = await call('manager', 'POST', `${posts()}/trash`, { postIds: [draft, scheduled] })
    expect(r.status).toBe(409)
    expect((await row(draft))?.trashed).toBe(false)
    const cancelled = await post({ status: 'cancelled' })
    const ok = await call('manager', 'POST', `${posts()}/trash`, { postIds: [cancelled] })
    expect(ok.status).toBe(200)
    expect(await row(cancelled)).toMatchObject({ status: 'cancelled', trashed: true })
  })

  test('more than 100, or the same twice, is refused before anything', async () => {
    const id = await post()
    const many = Array.from({ length: 101 }, () => randomUUID())
    expect((await call('manager', 'POST', `${posts()}/trash`, { postIds: many })).status).toBe(422)
    expect((await call('manager', 'POST', `${posts()}/trash`, { postIds: [id, id] })).status).toBe(
      422,
    )
    // a post of another client is not found
    expect(
      (await call('manager', 'POST', `${posts()}/trash`, { postIds: [randomUUID()] })).status,
    ).toBe(404)
  })

  test('the Viewer reads «Eliminati» and changes nothing', async () => {
    const id = await post({ trashed: true })
    const list = await call('viewer', 'GET', `/calendar/drafts?workspaceId=${forno}&trashed=1`)
    expect(list.status).toBe(200)
    expect((list.json as { items: { id: string }[] }).items.map((i) => i.id)).toContain(id)
    expect((await call('viewer', 'POST', `${posts()}/restore`, { postIds: [id] })).status).toBe(403)
  })

  test('an archived client’s drafts are read, not touched (409)', async () => {
    const id = await post({ workspaceId: archived })
    const r = await call('owner', 'POST', `${posts(archived)}/trash`, { postIds: [id] })
    expect(r.status).toBe(409)
  })
})

describe('a post in «Eliminati»', () => {
  test('«Ripristina» gives it back as it was, with a new version', async () => {
    const id = await post({ status: 'cancelled' })
    await call('editor', 'POST', `${posts()}/trash`, { postIds: [id] })
    const before = await row(id)
    const r = await call('editor', 'POST', `${posts()}/restore`, { postIds: [id] })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    expect((r.json as { postIds: string[] }).postIds).toEqual([id])
    expect(await row(id)).toMatchObject({
      status: 'cancelled',
      trashed: false,
      version: (before?.version ?? 0) + 1,
    })
    // once more is nothing to do
    const again = await call('editor', 'POST', `${posts()}/restore`, { postIds: [id] })
    expect((again.json as { postIds: string[] }).postIds).toEqual([])
  })

  test('saving, scheduling, «Duplica» and a note answer 409 «eliminata»', async () => {
    const id = await post({ when: null })
    await call('editor', 'POST', `${posts()}/trash`, { postIds: [id] })
    const version = (await row(id))?.version ?? 0
    const read = await call('editor', 'GET', `${posts()}/${id}`)
    expect(read.status).toBe(200)
    expect((read.json as { trashedAt: string | null }).trashedAt).not.toBeNull()
    const save = await call('editor', 'PATCH', `${posts()}/${id}`, {
      version,
      caption: { common: 'x' },
    })
    expect(save.status).toBe(409)
    expect(errorOf(save).message).toContain('eliminata')
    expect((await call('manager', 'POST', `${posts()}/${id}/schedule`, { version })).status).toBe(
      409,
    )
    const duplicate = await call('editor', 'POST', `${posts()}/${id}/duplicate`, {
      dates: [{ localDate: '2027-01-20', localTime: '12:00' }],
      schedule: false,
    })
    expect(duplicate.status).toBe(409)
    const note = await call('editor', 'POST', `${posts()}/${id}/notes`, { body: 'Da rivedere' })
    expect(note.status).toBe(409)
  })

  test('it is in no read but «Eliminati»: calendar, list, drafts, «Oggi»', async () => {
    const dated = await post({ when: new Date('2027-02-10T10:00:00Z'), trashed: true })
    const undated = await post({ when: null, trashed: true })
    const kept = await post({ when: null })
    const ids = (r: { json: unknown }, key: 'posts' | 'items') =>
      ((r.json as Record<string, { id: string }[]>)[key] ?? []).map((p) => p.id)
    const month = await call(
      'manager',
      'GET',
      `/calendar?from=2027-02-01&to=2027-02-28&workspaceId=${forno}`,
    )
    expect(ids(month, 'posts')).not.toContain(dated)
    const drafts = await call('manager', 'GET', `/calendar/drafts?workspaceId=${forno}`)
    expect(ids(drafts, 'items')).toContain(kept)
    expect(ids(drafts, 'items')).not.toContain(undated)
    const today = await call('manager', 'GET', `/agenda/drafts?workspaceId=${forno}`)
    expect(JSON.stringify(today.json)).not.toContain(undated)
    const trashed = await call('manager', 'GET', `/calendar/drafts?workspaceId=${forno}&trashed=1`)
    expect(ids(trashed, 'items')).toEqual(expect.arrayContaining([dated, undated]))
    expect(ids(trashed, 'items')).not.toContain(kept)
  })
})

describe('deleting for good', () => {
  test('`DELETE` takes a post in «Eliminati» or an empty draft, not a draft with something', async () => {
    const full = await post()
    const r = await call('editor', 'DELETE', `${posts()}/${full}`)
    expect(r.status).toBe(409)
    expect(await row(full)).not.toBeNull()
    const empty = await post({ caption: '', when: null })
    expect((await call('editor', 'DELETE', `${posts()}/${empty}`)).status).toBe(200)
    expect(await row(empty)).toBeNull()
    // an internal note is something: as the night and «Elimina le bozze vuote», it stays
    const noted = await post({ caption: '', when: null })
    await call('editor', 'POST', `${posts()}/${noted}/notes`, { body: 'Da rivedere' })
    expect((await call('editor', 'DELETE', `${posts()}/${noted}`)).status).toBe(409)
    expect(await row(noted)).not.toBeNull()
    const trashed = await post({ trashed: true })
    expect((await call('editor', 'DELETE', `${posts()}/${trashed}`)).status).toBe(200)
    expect(await row(trashed)).toBeNull()
  })

  test('«Elimina per sempre» takes only posts in «Eliminati»; «Svuota» what the person may', async () => {
    const draft = await post()
    const trashed = await post({ trashed: true })
    const refused = await call('editor', 'POST', `${posts()}/purge`, { postIds: [draft, trashed] })
    expect(refused.status).toBe(409)
    expect(await row(trashed)).not.toBeNull()
    const ok = await call('editor', 'POST', `${posts()}/purge`, { postIds: [trashed] })
    expect(ok.json).toEqual({ deleted: 1 })
    // «Svuota» of the Editor: their own only
    const mine = await post({ trashed: true })
    const theirs = await post({ trashed: true, author: people.manager.userId })
    const empty = await call('editor', 'POST', `${posts()}/purge`, { all: true })
    expect(empty.status).toBe(200)
    expect(await row(mine)).toBeNull()
    expect(await row(theirs)).not.toBeNull()
    await call('manager', 'POST', `${posts()}/purge`, { all: true })
    expect(await row(theirs)).toBeNull()
  })

  test('the plan’s content stays prepared in «Eliminati», and is to prepare once deleted', async () => {
    const item = await call('manager', 'POST', '/plan', {
      workspaceId: forno,
      localDate: '2027-03-15',
      localTime: '10:00',
      type: 'photo',
      title: 'Pane del lunedì',
    })
    const { id: itemId } = item.json as { id: string }
    const prepared = await call('manager', 'POST', `/plan/${itemId}/prepare`)
    const { postId } = prepared.json as { postId: string }
    const state = async () => {
      const r = await call(
        'manager',
        'GET',
        `/plan?workspaceId=${forno}&from=2027-03-15&to=2027-03-15`,
      )
      return (r.json as { items: { id: string; state: string }[] }).items.find(
        (i) => i.id === itemId,
      )?.state
    }
    await call('manager', 'POST', `${posts()}/trash`, { postIds: [postId] })
    expect(await state()).toBe('prepared')
    await call('manager', 'POST', `${posts()}/purge`, { postIds: [postId] })
    expect(await state()).not.toBe('prepared')
  })
})

describe('«Sposta negli Eliminati le bozze non toccate da»', () => {
  test('who manages the client chooses 30, 60, 90 days or «Mai»; the list tells when', async () => {
    const path = `/workspaces/${forno}`
    expect((await call('editor', 'PATCH', path, { draftRetentionDays: 60 })).status).toBe(403)
    expect((await call('manager', 'PATCH', path, { draftRetentionDays: 45 })).status).toBe(422)
    const set = await call('manager', 'PATCH', path, { draftRetentionDays: 60 })
    expect(set.status, JSON.stringify(set.json)).toBe(200)
    expect((set.json as { draftRetentionDays: number | null }).draftRetentionDays).toBe(60)
    const id = await post({ when: null })
    const drafts = await call('manager', 'GET', `/calendar/drafts?workspaceId=${forno}`)
    const item = (
      drafts.json as { items: { id: string; autoTrashAt: string | null; updatedAt: string }[] }
    ).items.find((i) => i.id === id)
    expect(item?.autoTrashAt).toBe(
      new Date(new Date(item?.updatedAt ?? 0).getTime() + 60 * 86_400_000).toISOString(),
    )
    await call('manager', 'PATCH', path, { draftRetentionDays: null })
    const never = await call('manager', 'GET', `/calendar/drafts?workspaceId=${forno}`)
    expect(
      (never.json as { items: { id: string; autoTrashAt: string | null }[] }).items.find(
        (i) => i.id === id,
      )?.autoTrashAt,
    ).toBeNull()
    const { rows } = await env.admin.pool.query<{ n: number }>(
      `select count(*)::int as n from audit_log where action = 'workspace.settings_changed'
         and entity_id = $1`,
      [forno],
    )
    expect(rows[0]?.n).toBe(2)
  })

  test('an archived client’s drafts are not announced: the night leaves them', async () => {
    const id = await post({ workspaceId: archived, when: null })
    const r = await call('manager', 'GET', `/calendar/drafts?workspaceId=${archived}`)
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    const item = (r.json as { items: { id: string; autoTrashAt: string | null }[] }).items.find(
      (i) => i.id === id,
    )
    expect(item).toBeDefined()
    expect(item?.autoTrashAt).toBeNull()
  })
})

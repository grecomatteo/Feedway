import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { seed } from '@app/infrastructure/testing'
import { startApiEnv } from './identity-env.js'
import type { ApiEnv, ErrorJson, Person } from './identity-env.js'

// The content settings of a client and the notes of a post over HTTP (plan 06 Task 7): who may
// change labels, templates and groups, a label of another client refused in a post, a note of
// someone else that an Editor cannot take off, a group whose account left the client, and notes
// that no other answer carries.

let env: ApiEnv
let org: { id: string; slug: string }
let other: { id: string; slug: string }
type Who = 'manager' | 'publisher' | 'editor' | 'editor2' | 'viewer'
const people = {} as Record<Who, Person>
const cookies = {} as Record<Who, string>
let forno: string, gino: string, archived: string, inOther: string
let ig: string, fb: string, inGino: string

const ws = (workspaceId = forno, slug = org.slug) =>
  `/api/v1/orgs/${slug}/workspaces/${workspaceId}`

async function call(
  who: Who,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
) {
  const r = await env.call(method, path, body, { cookie: cookies[who] })
  const text = await r.text()
  return { status: r.status, text, json: text === '' ? null : (JSON.parse(text) as unknown) }
}

type Answer = Promise<{ status: number; text: string; json: unknown }>

async function ok<T = Record<string, unknown>>(answer: Answer): Promise<T> {
  const r = await answer
  expect(r.status, r.text).toBe(200)
  return r.json as T
}

async function refused(answer: Answer, status: number, code: string) {
  const r = await answer
  expect(r.status, r.text).toBe(status)
  expect((r.json as ErrorJson).error.code, r.text).toBe(code)
  return (r.json as ErrorJson).error
}

const unique = (prefix: string) => `${prefix} ${randomUUID().slice(0, 6)}`

interface Label {
  id: string
  name: string
  color: string
  postCount: number
}
interface Group {
  id: string
  accountIds: string[]
  unavailableAccountIds: string[]
}
interface Note {
  id: string
  body: string
  authorId: string
  authorName: string
  canDelete: boolean
}
interface Post {
  id: string
  version: number
  labelIds: string[]
}

const label = (workspaceId = forno, slug = org.slug) =>
  ok<Label>(
    call('manager', 'POST', `${ws(workspaceId, slug)}/labels`, {
      name: unique('Natale'),
      color: 'verde',
    }),
  )

const draft = (who: Who = 'editor', body: Record<string, unknown> = {}) =>
  ok<Post>(call(who, 'POST', `${ws()}/posts`, { type: 'photo', ...body }))

beforeAll(async () => {
  env = await startApiEnv('content')
  org = await env.agency()
  other = await env.agency()
  for (const key of ['manager', 'publisher', 'editor', 'editor2', 'viewer'] as const)
    people[key] = await env.person(org.id, 'member')
  ;({ forno, gino, archived, inOther, ig, fb, inGino } = await seed(
    env.tdb.runtimeUrl,
    async (s) => {
      const f = await s.workspace(org.id, { name: 'Forno Luce' })
      const g = await s.workspace(org.id, { name: 'Pizzeria Da Gino' })
      const a = await s.workspace(org.id, { name: 'Vecchio cliente', archived: true })
      const o = await s.workspace(other.id, { name: 'Altra agenzia' })
      const roles: Record<Who, 'manager' | 'publisher' | 'editor' | 'viewer'> = {
        manager: 'manager',
        publisher: 'publisher',
        editor: 'editor',
        editor2: 'editor',
        viewer: 'viewer',
      }
      for (const [key, role] of Object.entries(roles)) {
        await s.workspaceMember(org.id, f, people[key as Who].userId, role)
        await s.workspaceMember(org.id, g, people[key as Who].userId, role)
        await s.workspaceMember(org.id, a, people[key as Who].userId, role)
      }
      return {
        forno: f,
        gino: g,
        archived: a,
        inOther: o,
        ig: await s.account(org.id, { platform: 'instagram', workspaceIds: [f] }),
        fb: await s.account(org.id, { platform: 'facebook', workspaceIds: [f] }),
        inGino: await s.account(org.id, { platform: 'instagram', workspaceIds: [g] }),
      }
    },
  ))
  for (const key of Object.keys(people) as Who[]) cookies[key] = await env.signIn(people[key])
}, 300_000)

afterAll(async () => {
  await env.stop()
})

describe('labels, templates and groups', () => {
  test('a Manager changes them; Publisher, Editor and Viewer read them and get 403 on writes', async () => {
    const made = await label()
    expect(made).toMatchObject({ color: 'verde', postCount: 0 })
    const template = await ok<{ id: string; kind: string }>(
      call('manager', 'POST', `${ws()}/caption-templates`, {
        kind: 'signature',
        name: 'Firma del forno',
        body: 'Forno Luce · via Garibaldi 12',
      }),
    )
    const group = await ok<Group>(
      call('manager', 'POST', `${ws()}/account-groups`, {
        name: 'Tutto il forno',
        accountIds: [ig, fb, ig],
      }),
    )
    expect(group).toMatchObject({ accountIds: [ig, fb], unavailableAccountIds: [] })
    for (const who of ['publisher', 'editor', 'viewer'] as const) {
      for (const path of ['labels', 'caption-templates', 'account-groups']) {
        const list = await ok<{ items: { id: string }[] }>(call(who, 'GET', `${ws()}/${path}`))
        expect(list.items.length, `${who} ${path}`).toBeGreaterThan(0)
      }
      await refused(
        call(who, 'POST', `${ws()}/labels`, { name: unique('Promo'), color: 'blu' }),
        403,
        'FORBIDDEN',
      )
      await refused(
        call(who, 'PATCH', `${ws()}/caption-templates/${template.id}`, { name: 'Mia' }),
        403,
        'FORBIDDEN',
      )
      await refused(call(who, 'DELETE', `${ws()}/account-groups/${group.id}`), 403, 'FORBIDDEN')
    }
    await ok(call('manager', 'PATCH', `${ws()}/labels/${made.id}`, { color: 'viola' }))
    await ok(call('manager', 'DELETE', `${ws()}/caption-templates/${template.id}`))
    await ok(call('manager', 'DELETE', `${ws()}/account-groups/${group.id}`))
  })

  test('every change goes in the activity log, with what was done and nothing of its text (D-76.3)', async () => {
    const made = await label()
    await ok(call('manager', 'PATCH', `${ws()}/labels/${made.id}`, { color: 'blu' }))
    await ok(call('manager', 'DELETE', `${ws()}/labels/${made.id}`))
    const template = await ok<{ id: string }>(
      call('manager', 'POST', `${ws()}/caption-templates`, {
        kind: 'signature',
        name: 'Firma segreta',
        body: 'Testo da non registrare',
      }),
    )
    const group = await ok<Group>(
      call('manager', 'POST', `${ws()}/account-groups`, { name: 'Gruppo', accountIds: [ig] }),
    )
    const { rows } = await env.admin.pool.query<{
      action: string
      entity: string
      entity_id: string
      actor_id: string
      workspace_id: string
      data: Record<string, unknown>
    }>(
      `select action, entity, entity_id, actor_id, workspace_id, data from audit_log
        where entity_id = any($1) order by created_at`,
      [[made.id, template.id, group.id]],
    )
    expect(rows).toEqual(
      [
        ['label', made.id, 'created'],
        ['label', made.id, 'updated'],
        ['label', made.id, 'deleted'],
        ['caption_template', template.id, 'created'],
        ['account_group', group.id, 'created'],
      ].map(([entity, id, change]) => ({
        action: 'workspace.settings_changed',
        entity,
        entity_id: id,
        actor_id: people.manager.userId,
        workspace_id: forno,
        data: { change },
      })),
    )
    // a note writes nothing (Matteo 18/11): everyday work, like the autosave
    const before = await env.admin.pool.query('select count(*)::int as n from audit_log')
    const { id: postId } = await ok<{ id: string }>(
      call('editor', 'POST', `${ws()}/posts`, { type: 'photo' }),
    )
    const after = await env.admin.pool.query('select count(*)::int as n from audit_log')
    await ok(call('editor', 'POST', `${ws()}/posts/${postId}/notes`, { body: 'Una nota' }))
    const withNote = await env.admin.pool.query('select count(*)::int as n from audit_log')
    expect(withNote.rows[0]).toEqual(after.rows[0])
    expect(before.rows.length).toBe(1)
  })

  test('a label name is the client’s once, whatever the case; a bad template is refused', async () => {
    const name = unique('Prodotti')
    await ok(call('manager', 'POST', `${ws()}/labels`, { name, color: 'blu' }))
    await refused(
      call('manager', 'POST', `${ws()}/labels`, { name: name.toUpperCase(), color: 'verde' }),
      409,
      'CONFLICT',
    )
    // another client may have it
    await ok(call('manager', 'POST', `${ws(gino)}/labels`, { name, color: 'blu' }))
    await refused(
      call('manager', 'POST', `${ws()}/caption-templates`, {
        kind: 'hashtags',
        name: 'Vuoto',
        body: '   ',
      }),
      422,
      'VALIDATION',
    )
  })

  test('whoever may not write gets 403 even with an invalid body', async () => {
    await refused(
      call('viewer', 'POST', `${ws()}/labels`, { name: '', color: 'blu' }),
      403,
      'FORBIDDEN',
    )
    await refused(
      call('editor', 'POST', `${ws()}/caption-templates`, {
        kind: 'hashtags',
        name: 'X',
        body: ' ',
      }),
      403,
      'FORBIDDEN',
    )
  })

  test('an archived client’s settings are read only', async () => {
    await ok(call('manager', 'GET', `${ws(archived)}/labels`))
    await refused(
      call('manager', 'POST', `${ws(archived)}/labels`, { name: 'Promo', color: 'blu' }),
      409,
      'CONFLICT',
    )
  })

  test('a group takes only the client’s accounts, and says which one left the client', async () => {
    await refused(
      call('manager', 'POST', `${ws()}/account-groups`, { name: 'Misto', accountIds: [inGino] }),
      404,
      'NOT_FOUND',
    )
    const group = await ok<Group>(
      call('manager', 'POST', `${ws()}/account-groups`, { name: 'Bistrot', accountIds: [ig, fb] }),
    )
    // Facebook is taken off the client
    await env.admin.pool.query(
      'delete from workspace_accounts where workspace_id = $1 and account_id = $2',
      [forno, fb],
    )
    try {
      const list = await ok<{ items: Group[] }>(call('editor', 'GET', `${ws()}/account-groups`))
      expect(list.items.find((g) => g.id === group.id)).toMatchObject({
        accountIds: [ig, fb],
        unavailableAccountIds: [fb],
      })
      // a rename keeps the saved accounts; a new list must be of the client's accounts
      await ok(
        call('manager', 'PATCH', `${ws()}/account-groups/${group.id}`, { name: 'Bistrot 2' }),
      )
      await refused(
        call('manager', 'PATCH', `${ws()}/account-groups/${group.id}`, { accountIds: [fb] }),
        404,
        'NOT_FOUND',
      )
    } finally {
      await env.admin.pool.query(
        'insert into workspace_accounts (organization_id, workspace_id, account_id) values ($1, $2, $3)',
        [org.id, forno, fb],
      )
    }
  })
})

describe('labels on a post', () => {
  test('a post takes the client’s labels; one of another client or agency is not found', async () => {
    const mine = await label()
    const ofGino = await label(gino)
    // written directly: the other agency's people are not this test's
    const ofOther = { id: randomUUID() }
    await env.admin.pool.query(
      `insert into labels (id, organization_id, workspace_id, name, color)
       values ($1, $2, $3, 'Altro', 'blu')`,
      [ofOther.id, other.id, inOther],
    )
    const post = await draft('editor', { labelIds: [mine.id] })
    expect(post.labelIds).toEqual([mine.id])
    for (const foreign of [ofGino.id, ofOther.id, randomUUID()])
      await refused(
        call('editor', 'PATCH', `${ws()}/posts/${post.id}`, {
          version: post.version,
          labelIds: [mine.id, foreign],
        }),
        404,
        'NOT_FOUND',
      )
    // nothing changed
    const now = await ok<Post>(call('editor', 'GET', `${ws()}/posts/${post.id}`))
    expect(now).toMatchObject({ version: 1, labelIds: [mine.id] })
    const listed = await ok<{ items: Label[] }>(call('viewer', 'GET', `${ws()}/labels`))
    expect(listed.items.find((l) => l.id === mine.id)?.postCount).toBe(1)
    // deleting the label takes it off the post
    await ok(call('manager', 'DELETE', `${ws()}/labels/${mine.id}`))
    const after = await ok<Post>(call('editor', 'GET', `${ws()}/posts/${post.id}`))
    expect(after.labelIds).toEqual([])
  })
})

describe('notes', () => {
  test('an Editor notes someone else’s post, and cannot take off a note of another (403)', async () => {
    const post = await draft('editor2')
    const own = await ok<Note>(
      call('editor', 'POST', `${ws()}/posts/${post.id}/notes`, {
        body: '  Il prezzo lo conferma Marta  ',
      }),
    )
    expect(own).toMatchObject({
      body: 'Il prezzo lo conferma Marta',
      authorId: people.editor.userId,
      canDelete: true,
    })
    expect(own.authorName).not.toBe('')
    const theirs = await ok<Note>(
      call('editor2', 'POST', `${ws()}/posts/${post.id}/notes`, { body: 'Foto da rifare' }),
    )
    const seen = await ok<{ items: Note[] }>(
      call('editor', 'GET', `${ws()}/posts/${post.id}/notes`),
    )
    expect(seen.items.map((n) => [n.id, n.canDelete])).toEqual([
      [own.id, true],
      [theirs.id, false],
    ])
    await refused(
      call('editor', 'DELETE', `${ws()}/posts/${post.id}/notes/${theirs.id}`),
      403,
      'FORBIDDEN',
    )
    await ok(call('editor', 'DELETE', `${ws()}/posts/${post.id}/notes/${own.id}`))
    // a Manager takes off anyone's
    await ok(call('manager', 'DELETE', `${ws()}/posts/${post.id}/notes/${theirs.id}`))
    expect(
      (await ok<{ items: Note[] }>(call('viewer', 'GET', `${ws()}/posts/${post.id}/notes`))).items,
    ).toEqual([])
  })

  test('on an archived client no note is offered for deletion', async () => {
    const post = await draft()
    const note = await ok<Note>(
      call('manager', 'POST', `${ws()}/posts/${post.id}/notes`, { body: 'Da archiviare' }),
    )
    await env.admin.pool.query('update workspaces set archived_at = now() where id = $1', [forno])
    try {
      const seen = await ok<{ items: Note[] }>(
        call('manager', 'GET', `${ws()}/posts/${post.id}/notes`),
      )
      expect(seen.items.map((n) => [n.id, n.canDelete])).toEqual([[note.id, false]])
      await refused(
        call('manager', 'DELETE', `${ws()}/posts/${post.id}/notes/${note.id}`),
        409,
        'CONFLICT',
      )
    } finally {
      await env.admin.pool.query('update workspaces set archived_at = null where id = $1', [forno])
    }
  })

  test('a post takes at most 200 notes', async () => {
    const post = await draft()
    await env.admin.pool.query(
      `insert into post_notes (id, organization_id, workspace_id, post_id, author_id, body)
       select gen_random_uuid(), p.organization_id, p.workspace_id, p.id, p.created_by, 'Nota ' || n
       from posts p, generate_series(1, 200) n where p.id = $1`,
      [post.id],
    )
    await refused(
      call('editor', 'POST', `${ws()}/posts/${post.id}/notes`, { body: 'Una di troppo' }),
      409,
      'CONFLICT',
    )
  })

  test('a Viewer reads the notes and writes none (403)', async () => {
    const post = await draft()
    await refused(
      call('viewer', 'POST', `${ws()}/posts/${post.id}/notes`, { body: 'Ciao' }),
      403,
      'FORBIDDEN',
    )
    await ok(call('viewer', 'GET', `${ws()}/posts/${post.id}/notes`))
  })

  test('a note of another post, or a post of another client, is not found', async () => {
    const a = await draft()
    const b = await draft()
    const note = await ok<Note>(
      call('editor', 'POST', `${ws()}/posts/${a.id}/notes`, { body: 'A' }),
    )
    await refused(
      call('manager', 'DELETE', `${ws()}/posts/${b.id}/notes/${note.id}`),
      404,
      'NOT_FOUND',
    )
    await refused(call('manager', 'GET', `${ws(gino)}/posts/${a.id}/notes`), 404, 'NOT_FOUND')
  })

  test('no other answer carries a note: the post, the list of posts', async () => {
    const secret = `Nota riservata ${randomUUID()}`
    const post = await draft()
    await ok(call('editor', 'POST', `${ws()}/posts/${post.id}/notes`, { body: secret }))
    for (const path of [`${ws()}/posts/${post.id}`, `${ws()}/posts`, `${ws()}/labels`]) {
      const r = await call('manager', 'GET', path)
      expect(r.status).toBe(200)
      expect(r.text, path).not.toContain(secret)
    }
  })
})

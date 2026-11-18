import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { seed, withScope } from '@app/infrastructure/testing'
import { startApiEnv } from './identity-env.js'
import type { ApiEnv, ErrorJson, Person } from './identity-env.js'

// The posts of a workspace over HTTP (plan 06 Task 4): drafts that save with any problem,
// scheduling that checks the saved post again, the version of every write, who may do what,
// and a file of a scheduled post that stays in the library.

let env: ApiEnv
let org: { id: string; slug: string }
let other: { id: string; slug: string }
const people = {} as Record<'manager' | 'publisher' | 'editor' | 'editor2' | 'viewer', Person>
const cookies = {} as Record<keyof typeof people, string>
let forno: string, archived: string, gino: string
let ig: string, inGino: string

/** A day far enough ahead for the checks, in the post's time zone (Rome). */
const WHEN = { localDate: '2027-06-10', localTime: '18:00' }

const READY_VIDEO = {
  kind: 'video',
  format: 'mp4',
  sizeBytes: 40_000_000,
  width: 1080,
  height: 1920,
  durationMs: 20_000,
  fps: 30,
  videoCodec: 'h264',
  audioCodec: 'aac',
  faststart: true,
}

/** A ready video of the workspace, as the worker leaves it: each one its own bytes. */
async function video(workspaceId = forno, organizationId = org.id): Promise<string> {
  const id = await seed(env.tdb.runtimeUrl, (s) =>
    s.media(organizationId, workspaceId, { uploadedBy: people.editor.userId }),
  )
  await env.admin.pool.query(
    'update media set analysis = $2, checks = $3, sha256 = $4 where id = $1',
    [
      id,
      JSON.stringify(READY_VIDEO),
      JSON.stringify({ fixes: [], warnings: [] }),
      randomBytes(32).toString('hex'),
    ],
  )
  return id
}

const base = (workspaceId = forno) => `/api/v1/orgs/${org.slug}/workspaces/${workspaceId}/posts`

interface PostJson {
  id: string
  status: string
  version: number
  type: string
  media: { id: string; status: string }[]
  caption: { common: string; instagram?: string }
  destinations: { accountId: string; status: string }[]
  when: { localDate: string; localTime: string } | null
  scheduledAt: string | null
  timezone: string
  createdBy: string
  scheduledBy: string | null
  updatedBy: string
}

type Who = keyof typeof people

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

async function expectOk<T = PostJson>(
  answer: Promise<{ status: number; text: string; json: unknown }>,
): Promise<T> {
  const r = await answer
  expect(r.status, r.text).toBe(200)
  return r.json as T
}

async function expectError(
  answer: Promise<{ status: number; text: string; json: unknown }>,
  status: number,
  code: string,
) {
  const r = await answer
  expect(r.status, r.text).toBe(status)
  const error = (r.json as ErrorJson & { error: { report?: unknown } }).error
  expect(error.code, r.text).toBe(code)
  return error
}

/** A reel ready to schedule on the workspace's Instagram account. */
async function draft(who: Who = 'editor', over: Record<string, unknown> = {}) {
  return expectOk(
    call(who, 'POST', base(), {
      type: 'reel',
      mediaIds: [await video()],
      caption: { common: `Il pane di oggi ${randomUUID().slice(0, 6)}` },
      destinations: [{ accountId: ig }],
      when: WHEN,
      ...over,
    }),
  )
}

/** The agency's limits, as the platform sets them (system scope only). */
const limits = (json: string) =>
  withScope(env.tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query('update organizations set limits = $2 where id = $1', [org.id, json]),
  )

const schedule = (who: Who, post: { id: string; version: number }) =>
  call(who, 'POST', `${base()}/${post.id}/schedule`, { version: post.version })

beforeAll(async () => {
  env = await startApiEnv('posts')
  org = await env.agency()
  other = await env.agency()
  for (const key of ['manager', 'publisher', 'editor', 'editor2', 'viewer'] as const)
    people[key] = await env.person(org.id, 'member')
  ;({ forno, archived, gino, ig, inGino } = await seed(env.tdb.runtimeUrl, async (s) => {
    const f = await s.workspace(org.id, { name: 'Forno Luce' })
    const a = await s.workspace(org.id, { name: 'Vecchio cliente', archived: true })
    const g = await s.workspace(org.id, { name: 'Pizzeria Da Gino' })
    const roles = {
      manager: 'manager',
      publisher: 'publisher',
      editor: 'editor',
      editor2: 'editor',
      viewer: 'viewer',
    } as const
    for (const [key, role] of Object.entries(roles)) {
      await s.workspaceMember(org.id, f, people[key as Who].userId, role)
      await s.workspaceMember(org.id, a, people[key as Who].userId, role)
    }
    return {
      forno: f,
      archived: a,
      gino: g,
      ig: await s.account(org.id, { platform: 'instagram', workspaceIds: [f] }),
      inGino: await s.account(org.id, { platform: 'instagram', workspaceIds: [g] }),
    }
  }))
  // checked by the daily job: an account never checked is a block
  await env.admin.pool.query("update social_accounts set health = 'ok' where id = $1", [ig])
  for (const key of Object.keys(people) as Who[]) cookies[key] = await env.signIn(people[key])
}, 300_000)

afterAll(async () => {
  await env.stop()
})

describe('drafts', () => {
  test('an Editor creates a draft in the agency’s time zone, and every member sees it', async () => {
    const post = await draft()
    expect(post).toMatchObject({
      status: 'draft',
      version: 1,
      type: 'reel',
      when: WHEN,
      timezone: 'Europe/Rome',
      createdBy: people.editor.userId,
      scheduledBy: null,
      destinations: [{ accountId: ig, status: 'draft' }],
    })
    expect(post.scheduledAt).toBe('2027-06-10T16:00:00.000Z')
    expect(post.media).toEqual([expect.objectContaining({ status: 'ready' })])
    const seen = await expectOk(call('viewer', 'GET', `${base()}/${post.id}`))
    expect(seen.id).toBe(post.id)
    const list = await expectOk<{ items: { id: string }[] }>(
      call('viewer', 'GET', `${base()}?status=draft`),
    )
    expect(list.items.map((p) => p.id)).toContain(post.id)
  })

  test('a draft saves with any problem: no file, no account, no date', async () => {
    const post = await expectOk(call('editor', 'POST', base(), { type: 'photo' }))
    expect(post).toMatchObject({ media: [], destinations: [], when: null, caption: { common: '' } })
  })

  test('a save with the version read goes up by one; a stale one is 409 and changes nothing', async () => {
    const post = await draft()
    const saved = await expectOk(
      call('editor', 'PATCH', `${base()}/${post.id}`, {
        version: 1,
        caption: { common: 'Nuovo testo', instagram: 'Solo Instagram' },
      }),
    )
    expect(saved).toMatchObject({
      version: 2,
      caption: { common: 'Nuovo testo', instagram: 'Solo Instagram' },
      // the fields left out stay as they were
      destinations: [{ accountId: ig }],
      when: WHEN,
    })
    const error = await expectError(
      call('manager', 'PATCH', `${base()}/${post.id}`, { version: 1, caption: { common: 'Mio' } }),
      409,
      'CONFLICT',
    )
    expect(error).toMatchObject({
      reason: 'post_version_conflict',
      message:
        'Il post è stato modificato da un’altra persona: ricarica per vedere la versione nuova',
    })
    const now = await expectOk(call('editor', 'GET', `${base()}/${post.id}`))
    expect(now.caption.common).toBe('Nuovo testo')
  })

  test('an Editor sees another’s draft but neither changes, deletes nor checks it (403)', async () => {
    const post = await draft('editor2')
    await expectOk(call('editor', 'GET', `${base()}/${post.id}`))
    await expectError(
      call('editor', 'PATCH', `${base()}/${post.id}`, { version: 1, caption: { common: 'x' } }),
      403,
      'FORBIDDEN',
    )
    await expectError(call('editor', 'DELETE', `${base()}/${post.id}`), 403, 'FORBIDDEN')
    await expectError(
      call('editor', 'POST', `/api/v1/orgs/${org.slug}/workspaces/${forno}/post-checks`, {
        type: 'reel',
        mediaIds: [],
        caption: { common: '' },
        destinations: [],
        when: { mode: 'at', ...WHEN },
        choices: [],
        postId: post.id,
      }),
      403,
      'FORBIDDEN',
    )
    // a Manager changes anyone's content
    await expectOk(
      call('manager', 'PATCH', `${base()}/${post.id}`, { version: 1, caption: { common: 'Ok' } }),
    )
  })

  test('a Viewer reads, and writes nothing (403)', async () => {
    await expectError(call('viewer', 'POST', base(), { type: 'photo' }), 403, 'FORBIDDEN')
    const post = await draft()
    await expectError(
      call('viewer', 'PATCH', `${base()}/${post.id}`, { version: 1, type: 'photo' }),
      403,
      'FORBIDDEN',
    )
    await expectError(schedule('viewer', post), 403, 'FORBIDDEN')
  })

  test('a file or an account of another client or agency is not found', async () => {
    const ofOther = await seed(env.tdb.runtimeUrl, async (s) =>
      s.media(other.id, await s.workspace(other.id), { uploadedBy: people.editor.userId }),
    )
    for (const mediaId of [ofOther, await video(gino), randomUUID()])
      await expectError(
        call('editor', 'POST', base(), { type: 'reel', mediaIds: [mediaId] }),
        404,
        'NOT_FOUND',
      )
    await expectError(
      call('editor', 'POST', base(), {
        type: 'reel',
        cover: { source: 'image', mediaId: ofOther },
      }),
      404,
      'NOT_FOUND',
    )
    await expectError(
      call('editor', 'POST', base(), { type: 'reel', destinations: [{ accountId: inGino }] }),
      404,
      'NOT_FOUND',
    )
    // a post of this workspace, asked through another one
    const post = await draft()
    await expectError(call('manager', 'GET', `${base(gino)}/${post.id}`), 404, 'NOT_FOUND')
  })

  test('an impossible date is refused', async () => {
    const error = await expectError(
      call('editor', 'POST', base(), {
        type: 'photo',
        when: { localDate: '2027-02-30', localTime: '18:00' },
      }),
      422,
      'VALIDATION',
    )
    expect(error.message).toBe('Questa data non esiste nel calendario')
  })

  test('an hour the clock change skips moves forward, as the checks warned (D-49)', async () => {
    const post = await expectOk(
      call('editor', 'POST', base(), {
        type: 'photo',
        when: { localDate: '2027-03-28', localTime: '02:30' },
      }),
    )
    expect(post.when).toEqual({ localDate: '2027-03-28', localTime: '03:30' })
    expect(post.scheduledAt).toBe('2027-03-28T01:30:00.000Z')
  })

  test('a Viewer sees the files of a post, not their names', async () => {
    const post = await draft()
    const seen = await expectOk<{ media: { originalName: string | null }[] }>(
      call('viewer', 'GET', `${base()}/${post.id}`),
    )
    expect(seen.media.map((m) => m.originalName)).toEqual([null])
    const listed = await expectOk<{ items: { id: string; media: { originalName: unknown }[] }[] }>(
      call('viewer', 'GET', base()),
    )
    expect(listed.items.find((p) => p.id === post.id)?.media[0]?.originalName).toBeNull()
    const byEditor = await expectOk<{ media: { originalName: string | null }[] }>(
      call('editor', 'GET', `${base()}/${post.id}`),
    )
    expect(byEditor.media[0]?.originalName).not.toBeNull()
  })

  test('an archived client: its posts are read, never written (409)', async () => {
    await expectError(call('manager', 'POST', base(archived), { type: 'photo' }), 409, 'CONFLICT')
    await expectOk(call('viewer', 'GET', base(archived)))
  })
})

describe('scheduling', () => {
  test('a post with a block is refused with its checks (422), and stays a draft', async () => {
    const post = await draft('editor', { destinations: [] })
    const error = await expectError(schedule('publisher', post), 422, 'VALIDATION')
    expect(error).toMatchObject({ reason: 'post_not_schedulable' })
    const report = error.report as { outcomes: { code: string }[]; canSchedule: boolean }
    expect(report.canSchedule).toBe(false)
    expect(report.outcomes.map((o) => o.code)).toContain('no_destinations')
    // nothing of the history leaves: no fingerprint, no orphan choice
    expect(JSON.stringify(report)).not.toMatch(/fingerprint|invalidChoices/)
    const now = await expectOk(call('editor', 'GET', `${base()}/${post.id}`))
    expect(now).toMatchObject({ status: 'draft', version: 1 })
  })

  test('without a date there is nothing to schedule (422)', async () => {
    const post = await draft('editor', { when: null })
    await expectError(schedule('publisher', post), 422, 'VALIDATION')
  })

  test('a Publisher schedules an Editor’s draft; its destinations get their fingerprint', async () => {
    const post = await draft()
    const scheduled = await expectOk(schedule('publisher', post))
    expect(scheduled).toMatchObject({
      status: 'scheduled',
      version: 2,
      createdBy: people.editor.userId,
      scheduledBy: people.publisher.userId,
      destinations: [{ accountId: ig, status: 'scheduled' }],
    })
    const { rows } = await env.admin.pool.query<{ fingerprint: string | null }>(
      'select fingerprint from post_targets where post_id = $1',
      [post.id],
    )
    expect(rows[0]?.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    // twice is a conflict of state, not a second schedule
    await expectError(schedule('publisher', scheduled), 409, 'CONFLICT')
  })

  test('an Editor does not schedule, not even their own draft (403)', async () => {
    const post = await draft()
    await expectError(schedule('editor', post), 403, 'FORBIDDEN')
  })

  test('the same post again is a duplicate; the first is never a duplicate of itself', async () => {
    const first = await expectOk(schedule('manager', await draft()))
    // the checks of the first, saved: it does not meet itself
    const own = await expectOk<{ outcomes: { code: string }[] }>(
      call('manager', 'POST', `/api/v1/orgs/${org.slug}/workspaces/${forno}/post-checks`, {
        type: 'reel',
        mediaIds: first.media.map((m) => m.id),
        caption: first.caption,
        destinations: [{ accountId: ig }],
        when: { mode: 'at', ...WHEN },
        choices: [],
        postId: first.id,
      }),
    )
    expect(own.outcomes.map((o) => o.code)).not.toContain('duplicate_post')
    // the same file and the same text, on the same account
    const second = await draft('editor', {
      mediaIds: first.media.map((m) => m.id),
      caption: first.caption,
      when: { localDate: '2027-06-11', localTime: '18:00' },
    })
    const error = await expectError(schedule('manager', second), 422, 'VALIDATION')
    const report = error.report as { outcomes: { code: string; key: string }[] }
    const duplicate = report.outcomes.find((o) => o.code === 'duplicate_post')
    expect(duplicate).toBeDefined()
    // the warning answered, it goes
    const answered = await expectOk(
      call('editor', 'PATCH', `${base()}/${second.id}`, {
        version: second.version,
        choices: [{ key: duplicate?.key, option: 'accept' }],
      }),
    )
    await expectOk(schedule('manager', answered))
  })

  test('a scheduled post saves only if its checks pass, and stays scheduled', async () => {
    const post = await expectOk(schedule('manager', await draft()))
    const saved = await expectOk(
      call('manager', 'PATCH', `${base()}/${post.id}`, {
        version: post.version,
        caption: { common: 'Testo cambiato' },
      }),
    )
    expect(saved).toMatchObject({ status: 'scheduled', version: post.version + 1 })
    // a change that blocks is refused whole
    const error = await expectError(
      call('manager', 'PATCH', `${base()}/${post.id}`, {
        version: saved.version,
        destinations: [],
      }),
      422,
      'VALIDATION',
    )
    expect(error.reason).toBe('post_not_schedulable')
    const now = await expectOk(call('manager', 'GET', `${base()}/${post.id}`))
    expect(now).toMatchObject({ version: saved.version, destinations: [{ accountId: ig }] })
    // a past date too
    await expectError(
      call('manager', 'PATCH', `${base()}/${post.id}`, {
        version: saved.version,
        when: { localDate: '2020-01-01', localTime: '10:00' },
      }),
      422,
      'VALIDATION',
    )
    // an Editor saves only drafts, even their own
    await expectError(
      call('editor', 'PATCH', `${base()}/${post.id}`, {
        version: saved.version,
        caption: { common: 'x' },
      }),
      403,
      'FORBIDDEN',
    )
  })

  test('back to draft, cancel and delete, each from the state that allows it', async () => {
    const post = await expectOk(schedule('publisher', await draft()))
    // a scheduled post is not deleted
    await expectError(call('manager', 'DELETE', `${base()}/${post.id}`), 409, 'CONFLICT')
    const back = await expectOk(
      call('publisher', 'POST', `${base()}/${post.id}/unschedule`, { version: post.version }),
    )
    expect(back).toMatchObject({
      status: 'draft',
      destinations: [{ accountId: ig, status: 'draft' }],
    })
    // a draft is deleted, never cancelled
    await expectError(
      call('publisher', 'POST', `${base()}/${post.id}/cancel`, { version: back.version }),
      409,
      'CONFLICT',
    )
    const again = await expectOk(schedule('publisher', back))
    const cancelled = await expectOk(
      call('publisher', 'POST', `${base()}/${post.id}/cancel`, { version: again.version }),
    )
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      destinations: [{ accountId: ig, status: 'cancelled' }],
    })
    await expectError(
      call('manager', 'PATCH', `${base()}/${post.id}`, {
        version: cancelled.version,
        caption: { common: 'x' },
      }),
      409,
      'CONFLICT',
    )
    // the author deletes it
    await expectOk(call('editor', 'DELETE', `${base()}/${post.id}`))
    await expectError(call('editor', 'GET', `${base()}/${post.id}`), 404, 'NOT_FOUND')
    const { rows } = await env.admin.pool.query<{ action: string }>(
      `select action from audit_log where entity_id = $1 order by created_at, id`,
      [post.id],
    )
    expect(rows.map((r) => r.action)).toEqual([
      'post.created',
      'post.scheduled',
      'post.unscheduled',
      'post.scheduled',
      'post.cancelled',
      'post.deleted',
    ])
  })

  test('the agency’s posts of a day stop at its limit (409)', async () => {
    const day = { localDate: '2027-07-01', localTime: '09:00' }
    await expectOk(schedule('manager', await draft('editor', { when: day })))
    await limits('{"posts_per_day": 1}')
    try {
      const second = await draft('editor', { when: { ...day, localTime: '23:30' } })
      await expectError(schedule('manager', second), 409, 'LIMIT_REACHED')
      // another day of the agency is free
      await expectOk(
        schedule(
          'manager',
          await expectOk(
            call('editor', 'PATCH', `${base()}/${second.id}`, {
              version: second.version,
              when: { localDate: '2027-07-02', localTime: '00:30' },
            }),
          ),
        ),
      )
    } finally {
      await limits('{}')
    }
  })
})

describe('a scheduled post moved or changed', () => {
  test('a Publisher changes their scheduled post; another’s only a Manager (403)', async () => {
    const own = await expectOk(schedule('publisher', await draft('publisher')))
    await expectOk(
      call('publisher', 'PATCH', `${base()}/${own.id}`, {
        version: own.version,
        caption: { common: 'Il pane di domani' },
      }),
    )
    const ofEditor = await expectOk(schedule('publisher', await draft('editor')))
    await expectError(
      call('publisher', 'PATCH', `${base()}/${ofEditor.id}`, {
        version: ofEditor.version,
        caption: { common: 'x' },
      }),
      403,
      'FORBIDDEN',
    )
    const changed = await expectOk(
      call('manager', 'PATCH', `${base()}/${ofEditor.id}`, {
        version: ofEditor.version,
        caption: { common: 'Il pane di domani, dal Manager' },
      }),
    )
    const { rows } = await env.admin.pool.query<{ action: string }>(
      'select action from audit_log where entity_id = $1 order by created_at, id',
      [ofEditor.id],
    )
    expect(rows.map((r) => r.action)).toEqual(['post.created', 'post.scheduled', 'post.updated'])
    expect(changed.status).toBe('scheduled')
  })

  test('moved onto a full day it is refused (409); a new hour on its own day is not', async () => {
    const first = { localDate: '2027-08-01', localTime: '09:00' }
    await expectOk(schedule('manager', await draft('editor', { when: first })))
    const second = await expectOk(
      schedule(
        'manager',
        await draft('editor', { when: { localDate: '2027-08-02', localTime: '09:00' } }),
      ),
    )
    await limits('{"posts_per_day": 1}')
    try {
      await expectError(
        call('manager', 'PATCH', `${base()}/${second.id}`, {
          version: second.version,
          when: { ...first, localTime: '20:00' },
        }),
        409,
        'LIMIT_REACHED',
      )
      const later = await expectOk(
        call('manager', 'PATCH', `${base()}/${second.id}`, {
          version: second.version,
          when: { localDate: '2027-08-02', localTime: '21:00' },
        }),
      )
      expect(later).toMatchObject({ status: 'scheduled', when: { localTime: '21:00' } })
    } finally {
      await limits('{}')
    }
  })
})

describe('files of the posts in the library', () => {
  test('a file of a scheduled post is not deleted (409); of a draft, it is', async () => {
    const scheduled = await expectOk(schedule('manager', await draft()))
    const fileId = scheduled.media[0]?.id ?? ''
    const library = `/api/v1/orgs/${org.slug}/workspaces/${forno}/media`
    const seen = await expectOk<{ usedIn: unknown }>(call('editor', 'GET', `${library}/${fileId}`))
    expect(seen.usedIn).toEqual({
      postId: scheduled.id,
      status: 'scheduled',
      scheduledAt: scheduled.scheduledAt,
    })
    const error = await expectError(
      call('editor', 'DELETE', `${library}/${fileId}`),
      409,
      'CONFLICT',
    )
    expect(error).toMatchObject({ reason: 'media_in_scheduled_post' })
    expect(error.message).toContain('del 10/06')

    const draftPost = await draft()
    const inDraft = draftPost.media[0]?.id ?? ''
    await expectOk(call('editor', 'DELETE', `${library}/${inDraft}`))
    const after = await expectOk(call('editor', 'GET', `${base()}/${draftPost.id}`))
    expect(after.media).toEqual([expect.objectContaining({ id: inDraft, status: 'deleted' })])
    // and the draft saves again with it
    await expectOk(
      call('editor', 'PATCH', `${base()}/${draftPost.id}`, {
        version: after.version,
        mediaIds: after.media.map((m) => m.id),
      }),
    )
  })

  test('«Nei post» lists only the files a post uses, its cover included', async () => {
    const library = `/api/v1/orgs/${org.slug}/workspaces/${forno}/media`
    const loose = await video()
    const used = await draft()
    const usedId = used.media[0]?.id ?? ''
    const listed = await expectOk<{ items: { id: string; usedIn: unknown }[] }>(
      call('editor', 'GET', `${library}?inPosts=true&limit=100`),
    )
    const ids = listed.items.map((m) => m.id)
    expect(ids).toContain(usedId)
    expect(ids).not.toContain(loose)
    expect(listed.items.every((m) => m.usedIn !== null)).toBe(true)
    const all = await expectOk<{ items: { id: string }[] }>(
      call('editor', 'GET', `${library}?limit=100`),
    )
    expect(all.items.map((m) => m.id)).toContain(loose)
  })

  test('a folder with a file of a scheduled post is not deleted (409)', async () => {
    const scheduled = await expectOk(schedule('manager', await draft()))
    const fileId = scheduled.media[0]?.id ?? ''
    const ws = `/api/v1/orgs/${org.slug}/workspaces/${forno}`
    const folder = await expectOk<{ id: string }>(
      call('manager', 'POST', `${ws}/folders`, { name: 'Pane', parentId: null }),
    )
    await expectOk(call('manager', 'PATCH', `${ws}/media/${fileId}`, { folderId: folder.id }))
    const error = await expectError(
      call('manager', 'DELETE', `${ws}/folders/${folder.id}?confirm=true`),
      409,
      'CONFLICT',
    )
    expect(error).toMatchObject({ reason: 'media_in_scheduled_post' })
    await expectOk(call('manager', 'GET', `${ws}/media/${fileId}`))
    // cancelled, the folder goes with its file
    await expectOk(
      call('manager', 'POST', `${base()}/${scheduled.id}/cancel`, { version: scheduled.version }),
    )
    await expectOk(call('manager', 'DELETE', `${ws}/folders/${folder.id}?confirm=true`))
  })
})

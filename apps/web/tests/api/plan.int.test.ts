import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { seed } from '@app/infrastructure/testing'
import { startApiEnv } from './identity-env.js'
import type { ApiEnv, ErrorJson, Person } from './identity-env.js'

// The editorial plan over HTTP (plan 09 Task 6, spec §11.12): who plans, prepares and reads it,
// «Prepara» twice, a cancelled post and a removed content, the calendar's card without the note,
// the time of a prepared post, the content a post comes from (the editor, Task 7), and the
// module turned off.

let env: ApiEnv
let org: { id: string; slug: string }
type Who = 'manager' | 'publisher' | 'editor' | 'viewer'
const people = {} as Record<Who, Person>
const cookies = {} as Record<Who, string>
let forno: string, gino: string, archived: string

async function call(
  who: Who,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  path: string,
  body?: unknown,
) {
  const r = await env.call(method, path, body, { cookie: cookies[who] })
  const text = await r.text()
  return { status: r.status, text, json: text === '' ? null : (JSON.parse(text) as unknown) }
}
type Answer = ReturnType<typeof call>

async function ok<T = Record<string, unknown>>(answer: Answer): Promise<T> {
  const r = await answer
  expect(r.status, r.text).toBe(200)
  return r.json as T
}

async function refused(answer: Answer, status: number, code: string) {
  const r = await answer
  expect(r.status, r.text).toBe(status)
  expect((r.json as ErrorJson).error.code, r.text).toBe(code)
  return r.json as ErrorJson
}

interface Item {
  id: string
  workspaceId: string
  localDate: string
  localTime: string | null
  type: string
  title: string
  note: string
  postId: string | null
  state: string
  dueAt: string
  version: number
}
interface Post {
  id: string
  type: string
  status: string
  when: { localDate: string; localTime: string } | null
}

const plan = () => `/api/v1/orgs/${org.slug}/plan`
const ws = (id = forno) => `/api/v1/orgs/${org.slug}/workspaces/${id}`
const read = (who: Who, from = '2027-01-01', to = '2027-01-31', workspaceId = forno) =>
  ok<{ timeZone: string; items: Item[] }>(
    call(who, 'GET', `${plan()}?workspaceId=${workspaceId}&from=${from}&to=${to}`),
  )
const add = (body: Record<string, unknown> = {}, who: Who = 'publisher') =>
  ok<Item>(
    call(who, 'POST', plan(), {
      workspaceId: forno,
      localDate: '2027-01-20',
      type: 'reel',
      title: 'Video 1',
      note: 'Il forno acceso, poco testo',
      ...body,
    }),
  )
const prepare = (id: string, who: Who = 'editor') => call(who, 'POST', `${plan()}/${id}/prepare`)
/** the content a post was prepared from, for the editor */
const planOf = (who: Who, postId: string, workspaceId = forno) =>
  call(who, 'GET', `${ws(workspaceId)}/posts/${postId}/plan`)
const calendar = (from = '2027-01-01', to = '2027-01-31') =>
  ok<{
    posts: { id: string; marks: string[] }[]
    entries: { id: string; source: string; kind: string; data: Record<string, unknown> }[]
  }>(call('viewer', 'GET', `/api/v1/orgs/${org.slug}/calendar?from=${from}&to=${to}`))

beforeAll(async () => {
  env = await startApiEnv('plan')
  org = await env.agency()
  for (const key of ['manager', 'publisher', 'editor', 'viewer'] as const)
    people[key] = await env.person(org.id, 'member')
  ;({ forno, gino, archived } = await seed(env.tdb.runtimeUrl, async (s) => {
    const f = await s.workspace(org.id, { name: 'Forno Luce' })
    const g = await s.workspace(org.id, { name: 'Pizzeria Da Gino' })
    const a = await s.workspace(org.id, { name: 'Vecchio cliente', archived: true })
    for (const key of Object.keys(people) as Who[]) {
      await s.workspaceMember(org.id, f, people[key].userId, key)
      await s.workspaceMember(org.id, a, people[key].userId, key)
    }
    return { forno: f, gino: g, archived: a }
  }))
  for (const key of Object.keys(people) as Who[]) cookies[key] = await env.signIn(people[key])
}, 300_000)

afterAll(async () => {
  await env.stop()
})

describe('the plan', () => {
  test('a Publisher plans; Editor and Viewer read it, note included; the Editor cannot plan', async () => {
    const item = await add({ localTime: '12:30', note: 'Riprese\tdel mattino' })
    expect(item).toMatchObject({
      localDate: '2027-01-20',
      localTime: '12:30',
      type: 'reel',
      title: 'Video 1',
      // a tab is a space
      note: 'Riprese del mattino',
      postId: null,
      state: 'to_prepare',
      dueAt: '2027-01-20T11:30:00.000Z',
      // the card turns yellow when the notification goes out: 36 hours before
      dueSoonAt: '2027-01-18T23:30:00.000Z',
      version: 1,
    })
    for (const who of ['viewer', 'editor'] as const)
      expect((await read(who)).items.find((i) => i.id === item.id)?.note).toBe(
        'Riprese del mattino',
      )
    await refused(call('editor', 'POST', plan(), { ...item, id: undefined }), 422, 'VALIDATION')
    await refused(
      call('editor', 'POST', plan(), {
        workspaceId: forno,
        localDate: '2027-01-21',
        type: 'photo',
        title: 'Foto',
      }),
      403,
      'FORBIDDEN',
    )
    for (const who of ['editor', 'viewer'] as const) {
      await refused(
        call(who, 'PATCH', `${plan()}/${item.id}`, { version: 1, title: 'X' }),
        403,
        'FORBIDDEN',
      )
      await refused(call(who, 'DELETE', `${plan()}/${item.id}`), 403, 'FORBIDDEN')
    }
    await refused(prepare(item.id, 'viewer'), 403, 'FORBIDDEN')
  })

  test('day, type and title are needed and checked', async () => {
    for (const body of [
      { localDate: '2027-02-30' },
      { type: 'video' },
      { title: '  ' },
      { title: 'Vai su www.esempio.it' },
      { localTime: '24:00' },
      { note: 'x'.repeat(2001) },
    ])
      await refused(
        call('publisher', 'POST', plan(), {
          workspaceId: forno,
          localDate: '2027-01-22',
          type: 'photo',
          title: 'Foto',
          ...body,
        }),
        422,
        'VALIDATION',
      )
    await refused(
      call('viewer', 'GET', `${plan()}?workspaceId=${forno}&from=2027-01-01&to=2027-03-01`),
      422,
      'VALIDATION',
    )
  })

  test('a change carries the version: an old one is refused and changes nothing', async () => {
    const item = await add({ title: 'Carosello menu', type: 'carousel' })
    const moved = await ok<Item>(
      call('manager', 'PATCH', `${plan()}/${item.id}`, {
        version: 1,
        localDate: '2027-01-22',
        localTime: null,
      }),
    )
    expect(moved).toMatchObject({ localDate: '2027-01-22', version: 2, title: 'Carosello menu' })
    const conflict = await refused(
      call('publisher', 'PATCH', `${plan()}/${item.id}`, { version: 1, title: 'Altro' }),
      409,
      'CONFLICT',
    )
    expect(conflict.error.reason).toBe('plan_item_version_conflict')
    expect((await read('viewer')).items.find((i) => i.id === item.id)?.title).toBe('Carosello menu')
  })

  test('«Prepara» twice gives one draft; the second answers with it', async () => {
    const item = await add({ localDate: '2027-01-23', localTime: '09:15', type: 'story' })
    const [first, second] = await Promise.all([prepare(item.id), prepare(item.id)])
    const answers = [first, second].map((r) => {
      expect(r.status, r.text).toBe(200)
      return r.json as { postId: string; created: boolean; workspaceId: string }
    })
    expect(answers.map((a) => a.created).sort()).toEqual([false, true])
    // the client of the content, for a link that opens it under another client (Task 7, PR 2)
    expect(answers.map((a) => a.workspaceId)).toEqual([forno, forno])
    expect(answers[0]?.postId).toBe(answers[1]?.postId)
    const postId = answers[0]?.postId ?? ''
    const post = await ok<Post>(call('editor', 'GET', `${ws()}/posts/${postId}`))
    expect(post).toMatchObject({
      type: 'story',
      status: 'draft',
      when: { localDate: '2027-01-23', localTime: '09:15' },
    })
    const after = (await read('viewer')).items.find((i) => i.id === item.id)
    expect(after).toMatchObject({ postId, state: 'prepared' })
  })

  test('a cancelled post gives the content back, and «Prepara» replaces the link', async () => {
    const item = await add({ localDate: '2027-01-24' })
    const { postId } = await ok<{ postId: string }>(prepare(item.id))
    await env.admin.pool.query("update posts set status = 'cancelled' where id = $1", [postId])
    expect((await read('viewer')).items.find((i) => i.id === item.id)?.state).toBe('to_prepare')
    const again = await ok<{ postId: string; created: boolean }>(prepare(item.id))
    expect(again.created).toBe(true)
    expect(again.postId).not.toBe(postId)
    expect((await read('viewer')).items.find((i) => i.id === item.id)?.postId).toBe(again.postId)
  })

  test('a deleted post frees the content; a removed content leaves its post', async () => {
    const a = await add({ localDate: '2027-01-25' })
    const { postId: deleted } = await ok<{ postId: string }>(prepare(a.id))
    // «Eliminati» first, then for good (plan 09 Scelta 12)
    await ok(call('editor', 'POST', `${ws()}/posts/trash`, { postIds: [deleted] }))
    await ok(call('editor', 'DELETE', `${ws()}/posts/${deleted}`))
    expect((await read('viewer')).items.find((i) => i.id === a.id)).toMatchObject({
      postId: null,
      state: 'to_prepare',
    })
    const b = await add({ localDate: '2027-01-26' })
    const { postId } = await ok<{ postId: string }>(prepare(b.id))
    await ok(call('publisher', 'DELETE', `${plan()}/${b.id}`))
    expect((await read('viewer')).items.some((i) => i.id === b.id)).toBe(false)
    await ok(call('editor', 'GET', `${ws()}/posts/${postId}`))
    await refused(call('publisher', 'DELETE', `${plan()}/${b.id}`), 404, 'NOT_FOUND')
  })

  test('without a time: the day’s first free slot, then the usual time, then 14:00', async () => {
    const at = async (localDate: string) => {
      const item = await add({ localDate, localTime: null })
      const { postId } = await ok<{ postId: string }>(prepare(item.id))
      return (await ok<Post>(call('editor', 'GET', `${ws()}/posts/${postId}`))).when?.localTime
    }
    // Wednesday 27 January 2027: a client is born with 14:00 as its usual time (Matteo, 25/11)
    expect(await at('2027-01-27')).toBe('14:00')
    // a slot on Wednesdays comes before the usual time
    await ok(
      call('manager', 'PUT', `${ws()}/time-slots`, {
        slots: [{ weekday: 3, localTime: '11:45' }],
      }),
    )
    expect(await at('2027-01-27')).toBe('11:45')
    // a slot on another day does not count: the usual time
    await ok(call('manager', 'PATCH', ws(), { defaultPostTime: '08:30' }))
    expect(await at('2027-01-28')).toBe('08:30')
    // no usual time: 14:00, as the editor
    await ok(call('manager', 'PATCH', ws(), { defaultPostTime: null }))
    expect(await at('2027-01-28')).toBe('14:00')
    await ok(call('manager', 'PUT', `${ws()}/time-slots`, { slots: [] }))
  })

  test('the calendar shows a card without the note, and the «dal piano» mark on the post', async () => {
    const todo = await add({ localDate: '2027-01-29', note: 'Segreto per chi prepara' })
    const done = await add({ localDate: '2027-01-30', note: 'Altro segreto' })
    const { postId } = await ok<{ postId: string }>(prepare(done.id))
    const r = await call(
      'viewer',
      'GET',
      `/api/v1/orgs/${org.slug}/calendar?from=2027-01-29&to=2027-01-30`,
    )
    expect(r.status, r.text).toBe(200)
    expect(r.text).not.toContain('Segreto')
    expect(r.text).not.toContain('Altro segreto')
    const { entries, posts } = await calendar('2027-01-29', '2027-01-30')
    const card = entries.find((e) => e.id === todo.id)
    expect(card).toMatchObject({ source: 'plan', kind: 'plan', title: 'Video 1' })
    // the fields of a card, one by one (rule 6, Scelta 11)
    expect(Object.keys(card?.data ?? {}).sort()).toEqual([
      'dueAt',
      'dueSoonAt',
      'postId',
      'state',
      'type',
    ])
    // a prepared content gives no card: its post carries the mark
    expect(entries.some((e) => e.id === done.id)).toBe(false)
    expect(posts.find((p) => p.id === postId)?.marks).toEqual(['plan'])
  })

  test('a post tells the content it comes from, note included, to whoever sees the client', async () => {
    const item = await add({ localDate: '2027-01-23', note: 'Luce dalla vetrina' })
    const { postId } = await ok<{ postId: string }>(prepare(item.id))
    for (const who of ['editor', 'viewer'] as const)
      expect(await ok(planOf(who, postId))).toMatchObject({
        item: {
          id: item.id,
          localDate: '2027-01-23',
          type: 'reel',
          title: 'Video 1',
          note: 'Luce dalla vetrina',
          postId,
          state: 'prepared',
        },
      })
    // a post that does not come from the plan: nothing to tell
    const plain = await ok<Post>(
      call('editor', 'POST', `${ws()}/posts`, {
        type: 'photo',
        caption: { common: 'Fuori dal piano' },
      }),
    )
    expect(await ok(planOf('editor', plain.id))).toEqual({ item: null })
    // no such post, or the post asked under another client of the agency
    await refused(planOf('editor', randomUUID()), 404, 'NOT_FOUND')
    await refused(planOf('editor', postId, archived), 404, 'NOT_FOUND')
    // a client the person does not see
    await refused(planOf('editor', postId, gino), 404, 'NOT_FOUND')
  })

  test('an archived client’s plan is read and not changed', async () => {
    await read('viewer', '2027-01-01', '2027-01-31', archived)
    await refused(
      call('publisher', 'POST', plan(), {
        workspaceId: archived,
        localDate: '2027-01-20',
        type: 'reel',
        title: 'Video',
      }),
      409,
      'CONFLICT',
    )
  })

  test('a client the person does not see is not found', async () => {
    await refused(
      call('manager', 'GET', `${plan()}?workspaceId=${gino}&from=2027-01-01&to=2027-01-31`),
      404,
      'NOT_FOUND',
    )
    await refused(
      call('manager', 'POST', plan(), {
        workspaceId: gino,
        localDate: '2027-01-20',
        type: 'reel',
        title: 'Video',
      }),
      404,
      'NOT_FOUND',
    )
  })

  test('with the module off: 404 everywhere and no card in the calendar', async () => {
    const item = await add({ localDate: '2027-01-31' })
    const prepared = await add({ localDate: '2027-01-30' })
    const { postId } = await ok<{ postId: string }>(prepare(prepared.id))
    await env.admin.pool.query(
      `update organizations set settings = settings || '{"modules":{"plan":false}}' where id = $1`,
      [org.id],
    )
    try {
      await refused(
        call('viewer', 'GET', `${plan()}?workspaceId=${forno}&from=2027-01-01&to=2027-01-31`),
        404,
        'NOT_FOUND',
      )
      await refused(
        call('publisher', 'POST', plan(), {
          workspaceId: forno,
          localDate: '2027-01-20',
          type: 'reel',
          title: 'Video 1',
        }),
        404,
        'NOT_FOUND',
      )
      await refused(
        call('manager', 'PATCH', `${plan()}/${item.id}`, { version: 1, title: 'X' }),
        404,
        'NOT_FOUND',
      )
      await refused(call('manager', 'DELETE', `${plan()}/${item.id}`), 404, 'NOT_FOUND')
      await refused(prepare(item.id), 404, 'NOT_FOUND')
      await refused(planOf('viewer', postId), 404, 'NOT_FOUND')
      expect((await calendar()).entries).toEqual([])
    } finally {
      await env.admin.pool.query(
        `update organizations set settings = settings - 'modules' where id = $1`,
        [org.id],
      )
    }
  })
})

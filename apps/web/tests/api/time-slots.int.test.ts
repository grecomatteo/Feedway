import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { seed } from '@app/infrastructure/testing'
import { startApiEnv } from './identity-env.js'
import type { ApiEnv, ErrorJson, Person } from './identity-env.js'

// The client's usual times over HTTP (plan 09 Task 9): who reads and who changes them, the list
// kept in order and once, the next free slot with a scheduled post at that minute, an archived
// client and a client of another agency.

let env: ApiEnv
let org: { id: string; slug: string }
let other: { id: string; slug: string }
type Who = 'manager' | 'publisher' | 'editor' | 'viewer'
const people = {} as Record<Who, Person>
const cookies = {} as Record<Who, string>
let forno: string, gino: string, archived: string, inOther: string

const ws = (workspaceId = forno, slug = org.slug) =>
  `/api/v1/orgs/${slug}/workspaces/${workspaceId}`

async function call(who: Who, method: 'GET' | 'PUT', path: string, body?: unknown) {
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
}

interface Slot {
  weekday: number
  localTime: string
}
interface Next {
  slot: { at: string; localDate: string; localTime: string } | null
}

const EVERY_DAY_AT_NOON = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, localTime: '12:00' }))
// Monday 4 January 2027, 09:00 in Rome
const MONDAY_MORNING = '2027-01-04T08:00:00.000Z'

/** A scheduled post of the workspace at that instant, written directly. */
async function scheduled(organizationId: string, workspaceId: string, at: string, by: string) {
  const id = randomUUID()
  await env.admin.pool.query(
    `insert into posts (id, organization_id, workspace_id, type, options, created_by, updated_by,
                        status, scheduled_at, scheduled_by)
     values ($1, $2, $3, 'photo', '{"shareToFeed":true,"choices":[]}', $4, $4, 'scheduled', $5, $4)`,
    [id, organizationId, workspaceId, by, at],
  )
  return id
}

beforeAll(async () => {
  env = await startApiEnv('slots')
  org = await env.agency()
  other = await env.agency()
  for (const key of ['manager', 'publisher', 'editor', 'viewer'] as const)
    people[key] = await env.person(org.id, 'member')
  ;({ forno, gino, archived, inOther } = await seed(env.tdb.runtimeUrl, async (s) => {
    const f = await s.workspace(org.id, { name: 'Forno Luce' })
    const g = await s.workspace(org.id, { name: 'Pizzeria Da Gino' })
    const a = await s.workspace(org.id, { name: 'Vecchio cliente', archived: true })
    const o = await s.workspace(other.id, { name: 'Altra agenzia' })
    for (const key of Object.keys(people) as Who[]) {
      await s.workspaceMember(org.id, f, people[key].userId, key)
      await s.workspaceMember(org.id, a, people[key].userId, key)
    }
    return { forno: f, gino: g, archived: a, inOther: o }
  }))
  for (const key of Object.keys(people) as Who[]) cookies[key] = await env.signIn(people[key])
}, 300_000)

afterAll(async () => {
  await env.stop()
})

describe('time slots', () => {
  test('a new client has none, and no next free slot', async () => {
    expect(await ok(call('viewer', 'GET', `${ws()}/time-slots`))).toEqual({ items: [] })
    expect(await ok(call('editor', 'GET', `${ws()}/next-free-slot`))).toEqual({ slot: null })
  })

  test('the Manager saves them whole: in order, a repeat once; the others read them', async () => {
    const saved = await ok<{ items: Slot[] }>(
      call('manager', 'PUT', `${ws()}/time-slots`, {
        slots: [
          { weekday: 5, localTime: '18:00' },
          { weekday: 1, localTime: '18:00' },
          { weekday: 1, localTime: '12:30' },
          { weekday: 5, localTime: '18:00' },
        ],
      }),
    )
    const expected = [
      { weekday: 1, localTime: '12:30' },
      { weekday: 1, localTime: '18:00' },
      { weekday: 5, localTime: '18:00' },
    ]
    expect(saved.items).toEqual(expected)
    for (const who of ['viewer', 'editor', 'publisher'] as const)
      expect((await ok<{ items: Slot[] }>(call(who, 'GET', `${ws()}/time-slots`))).items).toEqual(
        expected,
      )
    // one entry in the client's activity log, and none when the same list is saved again
    const count = async () =>
      Number(
        (
          await env.admin.pool.query<{ n: string }>(
            `select count(*) as n from audit_log where workspace_id = $1
               and action = 'workspace.settings_changed' and entity = 'time_slots'`,
            [forno],
          )
        ).rows[0]?.n,
      )
    expect(await count()).toBe(1)
    await ok(call('manager', 'PUT', `${ws()}/time-slots`, { slots: expected }))
    expect(await count()).toBe(1)
  })

  test('below Manager nobody changes them', async () => {
    for (const who of ['publisher', 'editor', 'viewer'] as const)
      await refused(call(who, 'PUT', `${ws()}/time-slots`, { slots: [] }), 403, 'FORBIDDEN')
  })

  test('a slot that is not a weekday and a time, or more than 70, is refused', async () => {
    for (const slot of [
      { weekday: 0, localTime: '12:00' },
      { weekday: 1, localTime: '24:00' },
      { weekday: 1, localTime: '9:00' },
    ])
      await refused(
        call('manager', 'PUT', `${ws()}/time-slots`, { slots: [slot] }),
        422,
        'VALIDATION',
      )
    const many = Array.from({ length: 71 }, (_, i) => ({
      weekday: (i % 7) + 1,
      localTime: `${String(Math.floor(i / 7)).padStart(2, '0')}:00`,
    }))
    await refused(call('manager', 'PUT', `${ws()}/time-slots`, { slots: many }), 422, 'VALIDATION')
  })

  test('the next free slot skips the minute of a scheduled post of the client only', async () => {
    await ok(call('manager', 'PUT', `${ws()}/time-slots`, { slots: EVERY_DAY_AT_NOON }))
    const next = (who: Who = 'editor') =>
      ok<Next>(call(who, 'GET', `${ws()}/next-free-slot?after=${MONDAY_MORNING}`))
    expect(await next()).toEqual({
      slot: { at: '2027-01-04T11:00:00.000Z', localDate: '2027-01-04', localTime: '12:00' },
    })
    // a post of another client, and a draft with that day, take nothing
    await scheduled(org.id, gino, '2027-01-04T11:00:00.000Z', people.manager.userId)
    await env.admin.pool.query(
      `insert into posts (id, organization_id, workspace_id, type, options, created_by,
                          updated_by, scheduled_at)
       values ($1, $2, $3, 'photo', '{"shareToFeed":true,"choices":[]}', $4, $4, $5)`,
      [randomUUID(), org.id, forno, people.editor.userId, '2027-01-04T11:00:00.000Z'],
    )
    expect((await next()).slot?.localDate).toBe('2027-01-04')
    await scheduled(org.id, forno, '2027-01-04T11:00:00.000Z', people.manager.userId)
    expect((await next('viewer')).slot).toEqual({
      at: '2027-01-05T11:00:00.000Z',
      localDate: '2027-01-05',
      localTime: '12:00',
    })
  })

  test('«Distribuisci»: the free slots in order, a scheduled minute skipped, at most 50', async () => {
    // the slot of 2027-01-04 at noon is taken by the test above
    const free = await ok<{ slots: { localDate: string; localTime: string }[] }>(
      call('viewer', 'GET', `${ws()}/free-slots?count=3&after=${MONDAY_MORNING}`),
    )
    expect(free.slots.map((s) => `${s.localDate} ${s.localTime}`)).toEqual([
      '2027-01-05 12:00',
      '2027-01-06 12:00',
      '2027-01-07 12:00',
    ])
    await refused(call('editor', 'GET', `${ws()}/free-slots?count=51`), 422, 'VALIDATION')
    await refused(call('manager', 'GET', `${ws(gino)}/free-slots?count=2`), 404, 'NOT_FOUND')
  })

  test('without `after`, the next one is ahead of now', async () => {
    const { slot } = await ok<Next>(call('editor', 'GET', `${ws()}/next-free-slot`))
    expect(slot).not.toBeNull()
    expect(Date.parse(slot?.at ?? '')).toBeGreaterThan(Date.now())
  })

  test('an archived client reads them and does not change them', async () => {
    await ok(call('manager', 'GET', `${ws(archived)}/time-slots`))
    await ok(call('editor', 'GET', `${ws(archived)}/next-free-slot`))
    await refused(
      call('manager', 'PUT', `${ws(archived)}/time-slots`, { slots: EVERY_DAY_AT_NOON }),
      409,
      'CONFLICT',
    )
  })

  test('a client the person does not see, or of another agency, is not found', async () => {
    for (const path of [ws(gino), ws(inOther)]) {
      await refused(call('manager', 'GET', `${path}/time-slots`), 404, 'NOT_FOUND')
      await refused(call('manager', 'GET', `${path}/next-free-slot`), 404, 'NOT_FOUND')
      await refused(
        call('manager', 'PUT', `${path}/time-slots`, { slots: EVERY_DAY_AT_NOON }),
        404,
        'NOT_FOUND',
      )
    }
  })
})

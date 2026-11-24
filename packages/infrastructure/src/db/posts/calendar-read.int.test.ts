import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  CALENDAR_MAX_ITEMS,
  getCalendar,
  type CalendarEntry,
  type Clock,
  type ModuleDefinition,
  type UnitOfWork,
} from '@app/application'
import type { CalendarFilters, OrgActor } from '@app/domain'
import { createDb, type DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'
import { createLogger } from '../../logging/logger.js'
import { uuidV7Generator } from '../../system/id-generator.js'
import { seed, startTestDatabase, type TestDatabase } from '../../testing/index.js'

// The calendar's read (plan 09 Task 2) on a real database: the modules' entries only for the
// agencies that use the module and only of the clients asked, the posts they mark, the days of
// the agency's zone across the changes of the clocks, the filters in SQL and the 2.000 cap.

let tdb: TestDatabase
let handle: DbHandle
let admin: pg.Client
let uow: UnitOfWork
let org: string, owner: string, forno: string, gino: string, ig: string, fb: string

const clock: Clock = { now: () => new Date('2026-11-24T10:00:00Z') }
const actor = (): OrgActor => ({
  userId: owner,
  platformRole: null,
  organizationId: org,
  orgRole: 'owner',
  memberships: new Map(),
})

async function post(
  workspaceId: string,
  opts: {
    when: Date | null
    status?: string
    type?: string
    accounts?: string[]
    createdBy?: string
  },
) {
  const id = randomUUID()
  await admin.query(
    `insert into posts (id, organization_id, workspace_id, type, caption, status, scheduled_at,
                        options, created_by, updated_by)
     values ($1, $2, $3, $4, 'Il pane', $5, $6, '{"shareToFeed":true,"choices":[]}', $7, $7)`,
    [
      id,
      org,
      workspaceId,
      opts.type ?? 'photo',
      opts.status ?? 'scheduled',
      opts.when,
      opts.createdBy ?? owner,
    ],
  )
  for (const accountId of opts.accounts ?? [])
    await admin.query(
      `insert into post_targets (id, organization_id, workspace_id, post_id, account_id, status)
       values ($1, $2, $3, $4, $5, 'scheduled')`,
      [randomUUID(), org, workspaceId, id, accountId],
    )
  return id
}

/** A module like the plan: an entry per client and day asked, and a post it marks. */
function planLike(marked: () => string, seen: { workspaceIds: readonly string[] }[]) {
  return {
    name: 'plan',
    permissions: [],
    queues: [],
    calendarEntries: {
      id: 'plan',
      entries: (_tx, query) => {
        seen.push(query)
        const entry = (workspaceId: string): CalendarEntry => ({
          source: 'plan',
          id: `e-${workspaceId}`,
          workspaceId,
          localDate: query.from,
          localTime: null,
          title: 'Reel del pane',
          kind: 'plan',
          data: { type: 'reel' },
        })
        // one for a client not asked too: the calendar must leave it out
        return Promise.resolve([...query.workspaceIds.map(entry), entry(randomUUID())])
      },
      markedPostIds: (_tx, ids) => Promise.resolve(new Set(ids.filter((id) => id === marked()))),
    },
  } satisfies ModuleDefinition
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 3, applicationName: 'calendar-read-test' })
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  uow = createUnitOfWork({
    db: handle.db,
    ids: uuidV7Generator,
    logger: createLogger({ service: 'web', level: 'error' }),
  })
  await seed(tdb.runtimeUrl, async (s) => {
    org = await s.organization()
    owner = await s.user()
    await s.member(org, owner, 'owner')
    forno = await s.workspace(org, { name: 'Forno Luce' })
    gino = await s.workspace(org, { name: 'Pizzeria Da Gino' })
    ig = await s.account(org, { platform: 'instagram', workspaceIds: [forno] })
    fb = await s.account(org, { platform: 'facebook', workspaceIds: [forno] })
  })
})

afterAll(async () => {
  await admin.end()
  await handle.close()
  await tdb.stop()
})

describe('the modules', () => {
  let marked: string
  const seen: { workspaceIds: readonly string[] }[] = []
  const modules = () => [planLike(() => marked, seen)]

  beforeAll(async () => {
    marked = await post(forno, { when: new Date('2027-01-05T10:00:00Z') })
  })

  test('an agency that uses the module sees its entries and marks, of the clients asked', async () => {
    const r = await getCalendar({ uow, clock, modules: modules() }, actor(), {
      from: '2027-01-04',
      to: '2027-01-10',
      workspaceId: forno,
    })
    expect(seen.at(-1)?.workspaceIds).toEqual([forno])
    expect(r.entries).toEqual([expect.objectContaining({ id: `e-${forno}`, source: 'plan' })])
    expect(r.posts.find((p) => p.id === marked)?.marks).toEqual(['plan'])
  })

  test('with the module off: no entry, no mark', async () => {
    await admin.query(
      `update organizations set settings = settings || '{"modules":{"plan":false}}' where id = $1`,
      [org],
    )
    const r = await getCalendar({ uow, clock, modules: modules() }, actor(), {
      from: '2027-01-04',
      to: '2027-01-10',
    })
    expect(r.entries).toEqual([])
    expect(r.posts.find((p) => p.id === marked)?.marks).toEqual([])
    await admin.query(`update organizations set settings = settings - 'modules' where id = $1`, [
      org,
    ])
  })

  test('a filter of the posts and «Mostra: Post» leave the entries out; «Piano» the posts', async () => {
    const read = (filters: Partial<CalendarFilters>) =>
      getCalendar({ uow, clock, modules: modules() }, actor(), {
        from: '2027-01-04',
        to: '2027-01-10',
        workspaceId: forno,
        filters,
      })
    expect((await read({ statuses: ['scheduled'] })).entries).toEqual([])
    expect((await read({ show: 'posts' })).entries).toEqual([])
    const plan = await read({ show: 'plan' })
    expect(plan.posts).toEqual([])
    expect(plan.entries).toHaveLength(1)
    const toPrepare = await read({ quick: 'to_prepare' })
    expect(toPrepare.posts).toEqual([])
    expect(toPrepare.entries).toHaveLength(1)
  })
})

describe('the days', () => {
  test('a post at 02:30 of the two changes of the clocks is in its day of Rome', async () => {
    // 25/10/2026 02:30 (twice: the first) and 28/03/2027 02:30 (missing: 03:30)
    const autumn = await post(gino, { when: new Date('2026-10-25T00:30:00Z') })
    const spring = await post(gino, { when: new Date('2027-03-28T01:30:00Z') })
    // the last minutes of the day of 25 hours, and the first of the next one
    const late = await post(gino, { when: new Date('2026-10-25T22:59:00Z') })
    const next = await post(gino, { when: new Date('2026-10-25T23:00:00Z') })
    const october = await getCalendar({ uow, clock, modules: [] }, actor(), {
      from: '2026-10-25',
      to: '2026-10-25',
      workspaceId: gino,
    })
    expect(october.posts.map((p) => [p.id, p.localDate, p.localTime])).toEqual([
      [autumn, '2026-10-25', '02:30'],
      [late, '2026-10-25', '23:59'],
    ])
    expect(october.posts.map((p) => p.id)).not.toContain(next)
    const march = await getCalendar({ uow, clock, modules: [] }, actor(), {
      from: '2027-03-28',
      to: '2027-03-28',
      workspaceId: gino,
    })
    expect(march.posts.map((p) => [p.id, p.localDate, p.localTime])).toEqual([
      [spring, '2027-03-28', '03:30'],
    ])
  })

  test('more than 42 days is refused', async () => {
    await expect(
      getCalendar({ uow, clock, modules: [] }, actor(), { from: '2026-12-01', to: '2027-01-12' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(
      getCalendar({ uow, clock, modules: [] }, actor(), { from: '2026-12-01', to: '2026-11-30' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

describe('the filters', () => {
  const day = '2027-02-10'
  const read = (filters: Partial<CalendarFilters> | undefined) =>
    getCalendar({ uow, clock, modules: [] }, actor(), {
      from: day,
      to: day,
      workspaceId: forno,
      ...(filters ? { filters } : {}),
    }).then((r) => r.posts.map((p) => p.id).sort())
  let onIg: string, onFb: string, reel: string, cancelled: string, draft: string, other: string

  beforeAll(async () => {
    const at = new Date(`${day}T10:00:00Z`)
    other = await seed(tdb.runtimeUrl, async (s) => {
      const u = await s.user()
      await s.member(org, u, 'member')
      return u
    })
    onIg = await post(forno, { when: at, accounts: [ig] })
    onFb = await post(forno, { when: at, accounts: [fb], createdBy: other })
    reel = await post(forno, { when: at, type: 'reel', accounts: [ig, fb] })
    cancelled = await post(forno, { when: at, status: 'cancelled' })
    draft = await post(forno, { when: at, status: 'draft' })
    const label = randomUUID()
    await admin.query(
      `insert into labels (id, organization_id, workspace_id, name, color)
       values ($1, $2, $3, 'Natale', 'verde')`,
      [label, org, forno],
    )
    await admin.query(
      `insert into post_labels (organization_id, workspace_id, post_id, label_id)
       values ($1, $2, $3, $4)`,
      [org, forno, onFb, label],
    )
    labelId = label
  })
  let labelId: string

  test('without filters: every post but the cancelled ones, a draft with a date included', async () => {
    expect(await read(undefined)).toEqual([onIg, onFb, reel, draft].sort())
    expect(await read({ statuses: ['cancelled'] })).toEqual([cancelled])
  })

  test('by account, platform, type, author and label, in SQL', async () => {
    expect(await read({ accountIds: [ig] })).toEqual([onIg, reel].sort())
    expect(await read({ platforms: ['facebook'] })).toEqual([onFb, reel].sort())
    expect(await read({ platforms: ['facebook'], accountIds: [ig] })).toEqual([])
    expect(await read({ types: ['reel'] })).toEqual([reel])
    expect(await read({ authorIds: [other] })).toEqual([onFb])
    expect(await read({ labelIds: [labelId] })).toEqual([onFb])
    expect(await read({ quick: 'to_publish' })).toEqual([onIg, onFb, reel].sort())
  })

  test('a row says where it goes, with its version', async () => {
    const r = await getCalendar({ uow, clock, modules: [] }, actor(), {
      from: day,
      to: day,
      workspaceId: forno,
    })
    expect(r.timeZone).toBe('Europe/Rome')
    expect(r.posts.find((p) => p.id === reel)).toMatchObject({
      type: 'reel',
      status: 'scheduled',
      localDate: day,
      localTime: '11:00',
      accounts: expect.arrayContaining([
        { id: ig, platform: 'instagram' },
        { id: fb, platform: 'facebook' },
      ]) as unknown,
      version: 1,
      empty: false,
      marks: [],
    })
  })
})

test(`more than ${String(CALENDAR_MAX_ITEMS)} posts: the first ones, and truncated`, async () => {
  const crowded = await seed(tdb.runtimeUrl, (s) => s.workspace(org, { name: 'Tanti post' }))
  await admin.query(
    `insert into posts (id, organization_id, workspace_id, type, caption, status, scheduled_at,
                        options, created_by, updated_by)
     select gen_random_uuid(), $1, $2, 'photo', '', 'scheduled',
            '2027-05-10T08:00:00Z'::timestamptz + n * interval '1 minute',
            '{"shareToFeed":true,"choices":[]}', $3, $3
     from generate_series(1, $4::int) n`,
    [org, crowded, owner, CALENDAR_MAX_ITEMS + 1],
  )
  const r = await getCalendar({ uow, clock, modules: [] }, actor(), {
    from: '2027-05-10',
    to: '2027-05-12',
    workspaceId: crowded,
  })
  expect(r.posts).toHaveLength(CALENDAR_MAX_ITEMS)
  expect(r.truncated).toBe(true)
}, 60_000)

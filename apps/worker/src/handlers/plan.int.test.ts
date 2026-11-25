import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  createPlanItem,
  dispatchNotifications,
  listMyNotifications,
  preparePlanItem,
  updatePlanItem,
} from '@app/application'
import { addDays, instantToZoned, zonedToInstant, type OrgActor } from '@app/domain'
import type { Runtime } from '@app/infrastructure'
import { seed, startTestDatabase, type TestDatabase } from '@app/infrastructure/testing'
import { startMetaMock, type MetaMock } from '@app/meta-mock'
import { accountsRuntime, agency, handlerDeps, recordingQueue } from '../../tests/accounts-jobs.js'
import { testClock } from '../../tests/publishing.js'
import { notifyDeps } from './notify.js'
import { planDueScan } from './plan.js'
import { reportDigest } from './report.js'

// «Da preparare, mancano meno di 36 ore» (plan 09 P3, Task 8; 36 hours, Matteo 25/11): the scan every 5 minutes writes
// the event once per content and reference instant, the dispatcher of stage 8 sends it to who
// prepares the client's plan, and the morning digest lists what to prepare. Never the note.

let tdb: TestDatabase
let mock: MetaMock
let runtime: Runtime
let admin: pg.Client

const ROME = 'Europe/Rome'
const NOTE = 'Nota riservata per chi prepara'

beforeAll(async () => {
  tdb = await startTestDatabase()
  mock = await startMetaMock()
  runtime = await accountsRuntime(tdb, mock)
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
}, 120_000)

afterAll(async () => {
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 }).catch(() => undefined)
  await runtime.close()
  await admin.end()
  await mock.stop()
  await tdb.stop()
})

const at = (localDate: string, localTime: string) =>
  zonedToInstant(localDate, localTime, ROME).instant

/** An agency with two clients: an Editor and a Viewer of the first, an Editor of the second. */
async function world() {
  const a = await agency(tdb, runtime)
  const people = await seed(tdb.runtimeUrl, async (s) => {
    const first = await s.workspace(a.organizationId, { name: 'Forno Luce' })
    const second = await s.workspace(a.organizationId, { name: 'Bar Sole' })
    const person = async (workspaceId: string, role: 'editor' | 'viewer') => {
      const id = await s.user()
      await s.member(a.organizationId, id, 'member')
      await s.workspaceMember(a.organizationId, workspaceId, id, role)
      return id
    }
    return {
      first,
      second,
      editor: await person(first, 'editor'),
      viewer: await person(first, 'viewer'),
      otherEditor: await person(second, 'editor'),
    }
  })
  const owner: OrgActor = {
    userId: a.ownerId,
    platformRole: null,
    organizationId: a.organizationId,
    orgRole: 'owner',
    memberships: new Map(),
  }
  return { ...a, ...people, owner }
}

type World = Awaited<ReturnType<typeof world>>

const planDeps = (clock = testClock()) => ({
  uow: runtime.uow,
  clock,
  ids: { newId: () => randomUUID() },
})

function addItem(w: World, localDate: string, localTime: string | null, title = 'Pane caldo') {
  return createPlanItem(planDeps(), w.owner, {
    workspaceId: w.first,
    localDate,
    localTime,
    type: 'reel',
    title,
    note: NOTE,
  })
}

async function scanAt(now: Date) {
  await planDueScan(
    { id: 'lavoro', data: {} },
    { ...handlerDeps(runtime, recordingQueue()), clock: testClock(now) },
  )
}

async function eventsOf(w: World) {
  const { rows } = await admin.query<{ payload: Record<string, string>; dedupe_key: string }>(
    `select payload, dedupe_key from outbox_events
      where organization_id = $1 and type = 'plan.due_soon' order by created_at`,
    [w.organizationId],
  )
  return rows
}

test('a content at 10:00 is told 36 hours before, when its card turns yellow, once', async () => {
  const w = await world()
  const item = await addItem(w, '2027-03-11', '10:00')
  await scanAt(at('2027-03-09', '21:59'))
  expect(await eventsOf(w)).toEqual([])
  await scanAt(at('2027-03-09', '22:00'))
  // two workers at the same minute, and the next run: still one event
  await Promise.all([scanAt(at('2027-03-09', '22:05')), scanAt(at('2027-03-09', '22:05'))])
  await scanAt(at('2027-03-09', '22:10'))
  const reference = at('2027-03-11', '10:00').toISOString()
  expect(await eventsOf(w)).toEqual([
    {
      payload: { workspaceId: w.first, planItemId: item.id, dueAt: reference },
      dedupe_key: `plan:${item.id}:${reference}`,
    },
  ])
})

test('a content without a time is told 36 hours before the end of its day', async () => {
  const w = await world()
  await addItem(w, '2027-03-11', null)
  await scanAt(at('2027-03-10', '11:58'))
  expect(await eventsOf(w)).toHaveLength(0)
  await scanAt(at('2027-03-10', '11:59'))
  expect(await eventsOf(w)).toHaveLength(1)
})

test('a content added after its time, or a worker stopped two hours, is told at the next run', async () => {
  const w = await world()
  await addItem(w, '2027-03-11', '10:00')
  await scanAt(at('2027-03-10', '12:00'))
  expect(await eventsOf(w)).toHaveLength(1)
})

test('a content past its reference instant is not told any more', async () => {
  const w = await world()
  await addItem(w, '2027-03-11', '10:00')
  await scanAt(at('2027-03-11', '10:00'))
  expect(await eventsOf(w)).toHaveLength(0)
})

test('a prepared content is not told', async () => {
  const w = await world()
  const item = await addItem(w, '2027-03-11', '10:00')
  await preparePlanItem(planDeps(), w.owner, { itemId: item.id })
  await scanAt(at('2027-03-10', '10:00'))
  expect(await eventsOf(w)).toHaveLength(0)
})

test('a content moved to another day is told again, with its new day', async () => {
  const w = await world()
  const item = await addItem(w, '2027-03-11', '10:00')
  await scanAt(at('2027-03-10', '10:00'))
  await updatePlanItem(planDeps(), w.owner, {
    itemId: item.id,
    version: item.version,
    localDate: '2027-03-12',
  })
  await scanAt(at('2027-03-11', '10:00'))
  const events = await eventsOf(w)
  expect(events.map((e) => e.payload.dueAt)).toEqual([
    at('2027-03-11', '10:00').toISOString(),
    at('2027-03-12', '10:00').toISOString(),
  ])
})

test('with the plan turned off for the agency nothing is told', async () => {
  const w = await world()
  await addItem(w, '2027-03-11', '10:00')
  await admin.query(
    `update organizations set settings = settings || '{"modules":{"plan":false}}'::jsonb where id = $1`,
    [w.organizationId],
  )
  await scanAt(at('2027-03-10', '10:00'))
  expect(await eventsOf(w)).toHaveLength(0)
})

test('across the change to summer time: 36 real hours, with or without a time', async () => {
  const w = await world()
  // 28 March 2027 in Rome loses an hour: 10:00 of the 28th is told at 21:00 of the 26th, and
  // the end of the 28th (23:59) at 10:59 of the 27th
  await addItem(w, '2027-03-28', '10:00', 'Con orario')
  await addItem(w, '2027-03-28', null, 'Senza orario')
  await scanAt(at('2027-03-26', '20:59'))
  expect(await eventsOf(w)).toHaveLength(0)
  await scanAt(at('2027-03-26', '21:00'))
  expect((await eventsOf(w)).map((e) => e.payload.dueAt)).toEqual([
    at('2027-03-28', '10:00').toISOString(),
  ])
  await scanAt(at('2027-03-27', '10:58'))
  expect(await eventsOf(w)).toHaveLength(1)
  await scanAt(at('2027-03-27', '10:59'))
  expect(await eventsOf(w)).toHaveLength(2)
})

test('who prepares the client gets it, without the note; a Viewer and another client’s Editor no', async () => {
  const w = await world()
  const content = await addItem(w, '2027-03-11', '10:00')
  const now = at('2027-03-10', '10:00')
  await scanAt(now)
  const deps = notifyDeps({
    ...handlerDeps(runtime, recordingQueue()),
    clock: testClock(now),
  })
  await dispatchNotifications(deps)
  const { rows } = await admin.query<{ user_id: string }>(
    `select n.user_id from notifications n join outbox_events e on e.id = n.event_id
      where e.organization_id = $1 and n.kind = 'plan.due_soon' order by n.user_id`,
    [w.organizationId],
  )
  expect(rows.map((r) => r.user_id).sort()).toEqual([w.ownerId, w.editor].sort())
  const page = await listMyNotifications(deps, w.editor)
  const item = page.items.find((i) => i.kind === 'plan.due_soon')
  expect(item?.title).toBe('Da preparare, mancano meno di 36 ore: «Pane caldo»')
  expect(item?.detail).toBe('Reel · «Pane caldo» · giovedì 11 marzo alle 10:00')
  expect(item?.context).toContain('Forno Luce')
  expect(item?.link?.path).toMatch(/\/piano\?spazio=.+&giorno=2027-03-11$/)
  expect(JSON.stringify(page)).not.toContain(NOTE)
  // prepared since: the centre keeps the words and the link of the notice already read
  await preparePlanItem(planDeps(), w.owner, { itemId: content.id })
  const later = await listMyNotifications(deps, w.editor)
  const kept = later.items.find((i) => i.kind === 'plan.due_soon')
  expect(kept?.title).toBe(item?.title)
  expect(kept?.link?.path).toBe(item?.link?.path)
})

test('the morning digest lists what to prepare today and tomorrow, without the note', async () => {
  const w = await world()
  const now = new Date()
  const today = instantToZoned(now, ROME).localDate
  await addItem(w, addDays(today, 1), null, 'Torta di mele')
  await addItem(w, addDays(today, 3), null, 'Più avanti')
  const sent: { to: string; text: string }[] = []
  const deps = {
    ...handlerDeps(runtime, recordingQueue()),
    clock: testClock(now),
    mailer: {
      isConfigured: () => Promise.resolve(true),
      send: (m: { to: string; text: string }) => {
        sent.push(m)
        return Promise.resolve('sent' as const)
      },
    },
  }
  for (const userId of [w.editor, w.viewer])
    await reportDigest(
      { id: 'lavoro', data: { userId, date: today, dueAt: now.toISOString() } },
      deps,
    )
  // the Viewer does not prepare: their digest has nothing to say, so none goes out
  expect(sent).toHaveLength(1)
  const text = sent[0]?.text ?? ''
  expect(text).toContain('Un contenuto del piano da preparare')
  expect(text).toContain('domani · Forno Luce · Reel «Torta di mele»')
  expect(text).not.toContain('Più avanti')
  expect(text).not.toContain(NOTE)
})

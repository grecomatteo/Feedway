import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { NotificationPage, NotificationPreferences } from '@app/contracts'
import { errorCodeOf, startApiEnv } from './identity-env.js'
import type { ApiEnv, Person } from './identity-env.js'

// The notification centre, the bell and the person's choices (plan 08 Task 6, §12.3, P6): the
// person reads their own rows of every agency where they work, worded with what they see now.

let env: ApiEnv
let a: { id: string; slug: string }
let b: { id: string; slug: string }
let suspended: { id: string; slug: string }
let giulia: Person, sara: Person
let giuliaCookie: string, saraCookie: string
let client: string

beforeAll(async () => {
  env = await startApiEnv('notifications')
  a = await env.agency()
  b = await env.agency()
  suspended = await env.agency({ status: 'suspended' })
  giulia = await env.person(a.id, 'owner', { name: 'Giulia Ferri' })
  sara = await env.person(a.id, 'member', { name: 'Sara Leoni' })
  await env.admin.pool.query(
    `insert into organization_members (organization_id, user_id, role) values ($1, $3, 'member'), ($2, $3, 'member')`,
    [b.id, suspended.id, giulia.userId],
  )
  client = randomUUID()
  await env.admin.pool.query(
    `insert into workspaces (id, organization_id, name, slug) values ($1, $2, 'Forno Luce', 'forno-luce')`,
    [client, a.id],
  )
  giuliaCookie = await env.strongSignIn(giulia)
  saraCookie = await env.signIn(sara)
}, 300_000)

afterAll(async () => {
  await env.stop()
})

let minute = 0
/** A notification as the dispatcher writes it, a minute after the one before. */
async function notify(
  organizationId: string | null,
  userId: string,
  kind: string,
  level: string,
  extra: { workspaceId?: string; payload?: Record<string, unknown>; email?: string } = {},
): Promise<string> {
  const id = randomUUID()
  minute++
  await env.admin.pool.query(
    `insert into notifications (id, organization_id, user_id, event_id, kind, level, workspace_id, payload, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now() - interval '1 day' + make_interval(mins => $9))`,
    [
      id,
      organizationId,
      userId,
      randomUUID(),
      kind,
      level,
      extra.workspaceId ?? null,
      JSON.stringify(extra.payload ?? {}),
      minute,
    ],
  )
  await env.admin.pool.query(
    `insert into notification_deliveries (id, organization_id, user_id, notification_id, kind, channel, status, error)
     values ($1, $2, $3, $4, $5, 'panel', 'sent', null), ($6, $2, $3, $4, $5, 'email', $7, $8)`,
    [
      randomUUID(),
      organizationId,
      userId,
      id,
      kind,
      randomUUID(),
      extra.email ? 'skipped' : 'sent',
      extra.email ?? null,
    ],
  )
  return id
}

const page = async (cookie: string, query = '') => {
  const r = await env.call('GET', `/api/v1/me/notifications${query}`, undefined, { cookie })
  expect(r.status, await r.clone().text()).toBe(200)
  return (await r.json()) as NotificationPage
}

test('the centre words each row now, says the channels and counts the unread ones', async () => {
  await notify(a.id, giulia.userId, 'meta.reminder', 'warning', {
    payload: { reminder: 'app_rejected' },
    email: 'Email non configurata sulla piattaforma',
  })
  await notify(b.id, giulia.userId, 'post.paused', 'warning', {
    workspaceId: randomUUID(),
    payload: { postId: randomUUID() },
  })
  // a suspended agency's rows wait until it is back (D-112 punto 6)
  await notify(suspended.id, giulia.userId, 'post.paused', 'warning')

  const got = await page(giuliaCookie)
  expect(got.unread).toBe(2)
  expect(got.items.map((i) => i.organization?.id)).toEqual([b.id, a.id])
  const [paused, reminder] = got.items
  expect(reminder).toMatchObject({
    kind: 'meta.reminder',
    title: 'Da sistemare su Meta',
    detail: "Meta non accetta più l'App ID o l'App Secret dell'agenzia",
    link: { path: `/${a.slug}/impostazioni/integrazioni/meta` },
    readAt: null,
  })
  expect(reminder?.deliveries).toEqual([
    { channel: 'panel', status: 'sent', error: null, sentAt: null },
    {
      channel: 'email',
      status: 'skipped',
      error: 'Email non configurata sulla piattaforma',
      sentAt: null,
    },
  ])
  // a member who does not see the client reads only that (P3, Review Focus 3)
  expect(paused).toMatchObject({
    title: 'Non vedi più ciò di cui parla questa notifica',
    detail: null,
    link: null,
  })

  const unread = await env.call('GET', '/api/v1/me/notifications/unread', undefined, {
    cookie: giuliaCookie,
  })
  expect(await unread.json()).toEqual({ unread: 2 })
})

test('the filters and the pages', async () => {
  expect((await page(giuliaCookie, `?organizationId=${a.id}`)).items).toHaveLength(1)
  expect((await page(giuliaCookie, '?kind=post.paused')).items).toHaveLength(1)
  expect((await page(giuliaCookie, '?level=error')).items).toHaveLength(0)
  // an agency she is not in: an empty page, not someone else's rows
  expect((await page(giuliaCookie, `?organizationId=${randomUUID()}`)).items).toHaveLength(0)
  const first = await page(giuliaCookie, '?limit=1')
  expect(first.items).toHaveLength(1)
  expect(first.nextCursor).not.toBeNull()
  const second = await page(
    giuliaCookie,
    `?limit=1&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
  )
  expect(second.items.map((i) => i.id)).not.toEqual(first.items.map((i) => i.id))
  expect(second.nextCursor).toBeNull()
  const bad = await env.call('GET', '/api/v1/me/notifications?cursor=nonsense', undefined, {
    cookie: giuliaCookie,
  })
  expect(bad.status).toBe(422)
})

test('read one, then all; another person’s is not found and stays unread', async () => {
  const saras = await notify(a.id, sara.userId, 'meta.reminder', 'warning', {
    payload: { reminder: 'app_rejected' },
  })
  const foreign = await env.call('POST', `/api/v1/me/notifications/${saras}/read`, undefined, {
    cookie: giuliaCookie,
  })
  expect(foreign.status).toBe(404)
  expect(await errorCodeOf(foreign)).toBe('NOT_FOUND')

  const [first] = (await page(giuliaCookie)).items
  const r = await env.call('POST', `/api/v1/me/notifications/${first?.id ?? ''}/read`, undefined, {
    cookie: giuliaCookie,
  })
  expect(await r.json()).toEqual({ unread: 1 })
  // twice is the same
  await env.call('POST', `/api/v1/me/notifications/${first?.id ?? ''}/read`, undefined, {
    cookie: giuliaCookie,
  })
  const all = await env.call('POST', '/api/v1/me/notifications/read-all', undefined, {
    cookie: giuliaCookie,
  })
  expect(await all.json()).toEqual({ unread: 0 })
  expect((await page(giuliaCookie, '?unread=true')).items).toEqual([])
  expect((await page(saraCookie)).unread).toBe(1)
})

const prefs = async (cookie: string) =>
  (await (
    await env.call('GET', '/api/v1/me/notifications/preferences', undefined, { cookie })
  ).json()) as NotificationPreferences

test('the choices list only the kinds the person can get; the defaults keep no row', async () => {
  const member = await prefs(saraCookie)
  expect(member.kinds.map((k) => k.kind)).not.toContain('meta.reminder')
  expect(member.kinds.map((k) => k.kind)).not.toContain('system.worker_down')
  expect(member.kinds.find((k) => k.kind === 'post.file_wont_publish')).toMatchObject({
    alwaysEmailToScheduler: true,
  })
  const owner = await prefs(giuliaCookie)
  expect(owner.kinds.map((k) => k.kind)).toContain('meta.reminder')
  expect(owner.settings).toEqual({
    minLevel: 'info',
    quietHours: null,
    digest: { enabled: true, time: '08:00', days: [1, 2, 3, 4, 5, 6, 7] },
    everythingEverywhere: false,
  })

  const set = (channels: string[] | null) =>
    env.call(
      'PUT',
      '/api/v1/me/notifications/preferences/kinds',
      { kind: 'post.confirmed', channels },
      { cookie: saraCookie },
    )
  const off = (await (await set([])).json()) as NotificationPreferences
  expect(off.kinds.find((k) => k.kind === 'post.confirmed')).toMatchObject({
    channels: [],
    changed: true,
  })
  // the same channels as the defaults: the row goes (P4)
  const back = (await (await set(['telegram', 'panel'])).json()) as NotificationPreferences
  expect(back.kinds.find((k) => k.kind === 'post.confirmed')).toMatchObject({ changed: false })
  const { rowCount } = await env.admin.pool.query(
    'select 1 from notification_prefs where user_id = $1',
    [sara.userId],
  )
  expect(rowCount).toBe(0)
  // a kind she cannot get is not found
  const admins = await env.call(
    'PUT',
    '/api/v1/me/notifications/preferences/kinds',
    { kind: 'meta.reminder', channels: ['panel'] },
    { cookie: saraCookie },
  )
  expect(admins.status).toBe(404)
})

test('the settings are saved whole and checked', async () => {
  const body = {
    minLevel: 'error',
    quietHours: { start: '22:00', end: '07:00' },
    digest: { enabled: true, time: '07:30', days: [5, 1, 1] },
    everythingEverywhere: false,
  }
  const r = await env.call('PUT', '/api/v1/me/notifications/preferences', body, {
    cookie: saraCookie,
  })
  expect(r.status).toBe(200)
  expect(((await r.json()) as NotificationPreferences).settings).toEqual({
    ...body,
    digest: { ...body.digest, days: [1, 5] },
  })
  const same = await env.call(
    'PUT',
    '/api/v1/me/notifications/preferences',
    { ...body, quietHours: { start: '22:00', end: '22:00' } },
    { cookie: saraCookie },
  )
  expect(same.status).toBe(422)
  const wrong = await env.call(
    'PUT',
    '/api/v1/me/notifications/preferences',
    { ...body, digest: { ...body.digest, time: '25:00' } },
    { cookie: saraCookie },
  )
  expect(wrong.status).toBe(422)
})

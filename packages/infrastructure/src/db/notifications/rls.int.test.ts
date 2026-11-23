import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { seed, startTestDatabase, withScope, type TestDatabase } from '../../testing/index.js'

// Row level security of the notification tables (plan 08, «Isolamento», P6), as app_runtime:
// the agency's scope sees its rows, the person's own scope their rows of the agencies where they
// are an active member, the system everything.
let tdb: TestDatabase
type Fn<T> = (c: pg.Client) => Promise<T>
const asSystem = <T>(fn: Fn<T>) => withScope(tdb.runtimeUrl, { kind: 'system' }, fn)
const asUser = <T>(userId: string, fn: Fn<T>) =>
  withScope(tdb.runtimeUrl, { kind: 'user', userId }, fn)
const inOrg = <T>(organizationId: string, fn: Fn<T>, userId?: string) =>
  withScope(
    tdb.runtimeUrl,
    { kind: 'organization', organizationId, ...(userId ? { userId } : {}) },
    fn,
  )

// u1 active in A; u2 active in A and B; u3 disabled in A
let orgA: string, orgB: string, u1: string, u2: string, u3: string
// notifications by owner and agency
const n = {
  u1A: randomUUID(),
  u2A: randomUUID(),
  u2B: randomUUID(),
  u2Platform: randomUUID(),
  u3A: randomUUID(),
}

const insertNotification = (c: pg.Client, id: string, org: string | null, user: string) =>
  c.query(
    `insert into notifications (id, organization_id, user_id, event_id, kind, level)
     values ($1, $2, $3, $4, 'post.target_failed', 'error')`,
    [id, org, user, randomUUID()],
  )
const insertDelivery = (c: pg.Client, notificationId: string, org: string | null, user: string) =>
  c.query(
    `insert into notification_deliveries (id, organization_id, user_id, notification_id, kind,
                                          channel)
     values ($1, $2, $3, $4, 'post.target_failed', 'email')`,
    [randomUUID(), org, user, notificationId],
  )
const ids = async (c: pg.Client, table: string, column = 'id') =>
  (await c.query<{ id: string }>(`select ${column} as id from ${table}`)).rows
    .map((r) => r.id)
    .sort()

beforeAll(async () => {
  tdb = await startTestDatabase()
  ;({ orgA, orgB, u1, u2, u3 } = await seed(tdb.runtimeUrl, async (s) => {
    const [orgA, orgB] = [await s.organization(), await s.organization()]
    const [u1, u2, u3] = [await s.user(), await s.user(), await s.user()]
    await s.member(orgA, u1, 'member')
    await s.member(orgA, u2, 'admin')
    await s.member(orgB, u2, 'owner')
    await s.member(orgA, u3, 'member', 'disabled')
    return { orgA, orgB, u1, u2, u3 }
  }))
  await asSystem(async (c) => {
    const rows: [string, string | null, string][] = [
      [n.u1A, orgA, u1],
      [n.u2A, orgA, u2],
      [n.u2B, orgB, u2],
      [n.u2Platform, null, u2],
      [n.u3A, orgA, u3],
    ]
    for (const [id, org, user] of rows) {
      await insertNotification(c, id, org, user)
      await insertDelivery(c, id, org, user)
    }
  })
})

afterAll(async () => {
  await tdb.stop()
})

const sorted = (...values: string[]) => [...values].sort()

test("notifications: an agency's scope sees its rows only, whoever acts in it", async () => {
  expect(await inOrg(orgA, (c) => ids(c, 'notifications'))).toEqual(sorted(n.u1A, n.u2A, n.u3A))
  // a person inside agency A does not see their own rows of B or of the platform there
  expect(await inOrg(orgA, (c) => ids(c, 'notifications'), u2)).toEqual(sorted(n.u1A, n.u2A, n.u3A))
  expect(await inOrg(orgB, (c) => ids(c, 'notification_deliveries', 'notification_id'))).toEqual([
    n.u2B,
  ])
})

test('notifications: an agency cannot write a row of another agency or of the platform', async () => {
  for (const org of [orgA, null])
    await expect(inOrg(orgB, (c) => insertNotification(c, randomUUID(), org, u2))).rejects.toThrow(
      /row-level security/,
    )
})

test('notifications: a person sees their own rows of their active agencies and of the platform (P6)', async () => {
  expect(await asUser(u2, (c) => ids(c, 'notifications'))).toEqual(
    sorted(n.u2A, n.u2B, n.u2Platform),
  )
  expect(await asUser(u2, (c) => ids(c, 'notification_deliveries', 'notification_id'))).toEqual(
    sorted(n.u2A, n.u2B, n.u2Platform),
  )
  expect(await asUser(u1, (c) => ids(c, 'notifications'))).toEqual([n.u1A])
  // disabled in A: nothing of A any more
  expect(await asUser(u3, (c) => ids(c, 'notifications'))).toEqual([])
})

test('notifications: a person marks their own as read, not another’s, and writes nothing new', async () => {
  const read = (userId: string) =>
    asUser(userId, (c) => c.query('update notifications set read_at = now()'))
  expect((await read(u1)).rowCount).toBe(1)
  const [mine] = await asSystem(
    async (c) =>
      (
        await c.query<{ read: boolean }>(
          'select read_at is not null as read from notifications where id = $1',
          [n.u1A],
        )
      ).rows,
  )
  expect(mine?.read).toBe(true)
  expect(
    (
      await asUser(u1, (c) =>
        c.query('update notifications set read_at = now() where id = $1', [n.u2A]),
      )
    ).rowCount,
  ).toBe(0)
  expect(
    (await asUser(u2, (c) => c.query('update notification_deliveries set error = null'))).rowCount,
  ).toBe(0)
  await expect(asUser(u2, (c) => insertNotification(c, randomUUID(), null, u2))).rejects.toThrow(
    /row-level security/,
  )
  // a row cannot be handed to someone else
  await expect(
    asUser(u2, (c) => c.query('update notifications set user_id = $1 where id = $2', [u1, n.u2B])),
  ).rejects.toThrow(/row-level security/)
})

test('preferences and settings: each person reaches only their own, the system everyone’s', async () => {
  for (const user of [u1, u2])
    await asUser(user, async (c) => {
      await c.query(
        `insert into notification_prefs (user_id, kind, channels) values ($1, 'post.confirmed', '{panel}')`,
        [user],
      )
      await c.query('insert into notification_settings (user_id) values ($1)', [user])
    })
  expect(await asUser(u1, (c) => ids(c, 'notification_prefs', 'user_id'))).toEqual([u1])
  expect(await asUser(u1, (c) => ids(c, 'notification_settings', 'user_id'))).toEqual([u1])
  // inside an agency the acting person still reaches only their own
  expect(await inOrg(orgA, (c) => ids(c, 'notification_settings', 'user_id'), u2)).toEqual([u2])
  expect(await inOrg(orgA, (c) => ids(c, 'notification_prefs', 'user_id'))).toEqual([])
  expect(
    (await asUser(u1, (c) => c.query('delete from notification_settings where user_id = $1', [u2])))
      .rowCount,
  ).toBe(0)
  await expect(
    asUser(u1, (c) =>
      c.query(
        `insert into notification_prefs (user_id, kind, channels) values ($1, 'post.paused', '{}')`,
        [u2],
      ),
    ),
  ).rejects.toThrow(/row-level security/)
  expect(await asSystem((c) => ids(c, 'notification_settings', 'user_id'))).toEqual(sorted(u1, u2))
})

test('telegram links: a person links the platform bot and the bots of their active agencies only', async () => {
  const link = (userId: string, org: string | null) =>
    asUser(userId, (c) =>
      c.query('insert into telegram_links (id, organization_id, user_id) values ($1, $2, $3)', [
        randomUUID(),
        org,
        userId,
      ]),
    )
  await link(u2, null)
  await link(u2, orgA)
  await link(u2, orgB)
  await link(u1, orgA)
  await expect(link(u1, orgB)).rejects.toThrow(/row-level security/)
  // disabled in A
  await expect(link(u3, orgA)).rejects.toThrow(/row-level security/)
  const orgs = (c: pg.Client) =>
    c
      .query<{ org: string | null }>('select organization_id as org from telegram_links')
      .then((r) => r.rows.map((x) => x.org ?? 'platform').sort())
  expect(await asUser(u2, orgs)).toEqual(sorted(orgA, orgB, 'platform'))
  // the delivery job of agency A for u2: A's bot and the platform's, not B's
  expect(await inOrg(orgA, orgs, u2)).toEqual(sorted(orgA, 'platform'))
  // an agency's job acting for nobody sees no person's chats
  expect(await inOrg(orgA, orgs)).toEqual([])
  expect(await asSystem(orgs)).toEqual(sorted(orgA, orgA, orgB, 'platform'))
})

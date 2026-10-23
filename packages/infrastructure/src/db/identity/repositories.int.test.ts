import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { Logger, UnitOfWork } from '@app/application'
import { uuidV7Generator } from '../../system/id-generator.js'
import { seed, startTestDatabase, waitForLockWaiter, withScope } from '../../testing/index.js'
import type { TestDatabase } from '../../testing/index.js'
import { createDb } from '../client.js'
import type { DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'

let tdb: TestDatabase
let handle: DbHandle
let uow: UnitOfWork
const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
}
const APP = 'identity-repos-test'

let anna: string, bruno: string, sessionOfAnna: string, sessionOfBruno: string

async function seedSession(userId: string) {
  const id = randomUUID()
  await withScope(tdb.runtimeUrl, { kind: 'none' }, (c) =>
    c.query(
      `insert into sessions (id, expires_at, updated_at, token, user_id, ip_address, user_agent)
       values ($1, now() + interval '1 day', now(), $2, $3, '203.0.113.7', 'Firefox')`,
      [id, `token-${id}`, userId],
    ),
  )
  return id
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 3, applicationName: APP })
  uow = createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger: silent })
  await seed(tdb.runtimeUrl, async (s) => {
    anna = await s.user({ email: 'Anna.Rossi@example.test', name: 'Anna' })
    bruno = await s.user({ email: 'bruno@example.test', name: 'Bruno' })
  })
  sessionOfAnna = await seedSession(anna)
  sessionOfBruno = await seedSession(bruno)
})
afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

test('findByEmail ignores case and never returns secrets', async () => {
  const user = await uow.run({ userId: anna }, (tx) =>
    tx.users.findByEmail('anna.rossi@EXAMPLE.test'),
  )
  expect(user).toMatchObject({
    id: anna,
    name: 'Anna',
    status: 'active',
    platformRole: null,
    twoFactorEnabled: false,
    theme: 'system',
    locale: 'it',
  })
  expect(Object.keys(user ?? {})).not.toContain('password')
  expect(
    await uow.run({ userId: anna }, (tx) => tx.users.findByEmail('nessuno@example.test')),
  ).toBeNull()
})

test('findByIdForUpdate locks the user row until the transaction ends', async () => {
  let release!: () => void
  const released = new Promise<void>((r) => (release = r))
  let locked!: () => void
  const lockTaken = new Promise<void>((r) => (locked = r))
  const first = uow.run({ userId: anna }, async (tx) => {
    expect((await tx.users.findByIdForUpdate(anna))?.id).toBe(anna)
    locked()
    await released
  })
  await lockTaken
  const second = uow.run({ userId: anna }, (tx) => tx.users.findByIdForUpdate(anna))
  await waitForLockWaiter(tdb.adminUrl, APP)
  release()
  await first
  expect((await second)?.id).toBe(anna)
})

test('sessions are listed for their user only, without the token', async () => {
  const list = await uow.run({ userId: anna }, (tx) => tx.sessions.findForUser(anna))
  expect(list.map((s) => s.id)).toEqual([sessionOfAnna])
  expect(list[0]).toMatchObject({ userId: anna, authMethod: 'password', reauthenticatedAt: null })
  expect(Object.keys(list[0] ?? {})).not.toContain('token')
})

test('session updates never reach another user session', async () => {
  const at = new Date('2026-10-18T10:00:00Z')
  await uow.run({ userId: anna }, async (tx) => {
    await tx.sessions.setReauthenticated(anna, sessionOfBruno, at)
    await tx.sessions.setAuthMethod(anna, sessionOfBruno, 'passkey')
    await tx.sessions.setReauthenticated(anna, sessionOfAnna, at)
    await tx.sessions.setAuthMethod(anna, sessionOfAnna, 'password_totp')
  })
  const [ofAnna] = await uow.run({ userId: anna }, (tx) => tx.sessions.findForUser(anna))
  const [ofBruno] = await uow.run({ userId: bruno }, (tx) => tx.sessions.findForUser(bruno))
  expect(ofAnna).toMatchObject({ reauthenticatedAt: at, authMethod: 'password_totp' })
  expect(ofBruno).toMatchObject({ reauthenticatedAt: null, authMethod: 'password' })
})

test('outside the system scope a user cannot reach sessions of someone else', async () => {
  const at = new Date('2026-10-18T11:00:00Z')
  await expect(
    uow.run({ userId: anna }, (tx) => tx.sessions.setAuthMethod(bruno, sessionOfBruno, 'passkey')),
  ).rejects.toThrow(/another user/)
  await expect(
    uow.run({ userId: anna }, (tx) => tx.sessions.setReauthenticated(bruno, sessionOfBruno, at)),
  ).rejects.toThrow(/another user/)
  await expect(uow.run({ userId: anna }, (tx) => tx.sessions.findForUser(bruno))).rejects.toThrow(
    /another user/,
  )
  const viaSystem = await uow.runAsSystem('test', (tx) => tx.sessions.findForUser(bruno))
  expect(viaSystem.map((s) => s.id)).toEqual([sessionOfBruno])
})

test('only the system scope enables an account, and never an anonymized one', async () => {
  const { carla, dario } = await seed(tdb.runtimeUrl, async (s) => ({
    carla: await s.user(),
    dario: await s.user(),
  }))
  const at = new Date('2026-10-20T08:00:00Z')
  await uow.run({ userId: carla }, (tx) => tx.users.disable(carla, at))
  await expect(uow.run({ userId: carla }, (tx) => tx.users.enable(carla, at))).rejects.toThrow(
    /system scope/,
  )
  expect(await uow.runAsSystem('test', (tx) => tx.users.enable(carla, at))).toBe(true)
  // already active: nothing changes
  expect(await uow.runAsSystem('test', (tx) => tx.users.enable(carla, at))).toBe(false)
  expect(await uow.runAsSystem('test', (tx) => tx.users.findById(carla))).toMatchObject({
    status: 'active',
    disabledAt: null,
    reactivatedAt: at,
  })
  await withScope(tdb.runtimeUrl, { kind: 'none' }, (c) =>
    c.query(
      "update users set status = 'disabled', disabled_at = now(), anonymized_at = now() where id = $1",
      [dario],
    ),
  )
  expect(await uow.runAsSystem('test', (tx) => tx.users.enable(dario, at))).toBe(false)
})

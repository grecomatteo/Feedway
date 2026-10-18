import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { Logger, UnitOfWork } from '@app/application'
import { uuidV7Generator } from '../../system/id-generator.js'
import { seed, startTestDatabase, withScope } from '../../testing/index.js'
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
  handle = createDb(tdb.runtimeUrl, { max: 3, applicationName: 'identity-repos-test' })
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
  const order: string[] = []
  const first = uow.run({ userId: anna }, async (tx) => {
    await tx.users.findByIdForUpdate(anna)
    await sleep(300)
    order.push('first')
  })
  await sleep(50)
  const second = uow.run({ userId: anna }, async (tx) => {
    await tx.users.findByIdForUpdate(anna)
    order.push('second')
  })
  await Promise.all([first, second])
  expect(order).toEqual(['first', 'second'])
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

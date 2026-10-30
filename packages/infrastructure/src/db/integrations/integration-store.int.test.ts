import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { SmtpConfig, Tx } from '@app/application'
import { createKeyRing } from '../../crypto/key-ring.js'
import { createLogger } from '../../logging/logger.js'
import { uuidV7Generator } from '../../system/id-generator.js'
import { fixedClock, seed, startTestDatabase, withScope } from '../../testing/index.js'
import type { TestDatabase } from '../../testing/index.js'
import { createDb } from '../client.js'
import type { DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'
import { createIntegrationStore } from './integration-store.js'

let tdb: TestDatabase
let handle: DbHandle
let orgA: string, ownerA: string
let uow: ReturnType<typeof createUnitOfWork>
const platformKey = randomBytes(32)
const store = createIntegrationStore({
  keyRing: createKeyRing({ platformKey, clock: fixedClock(new Date()) }),
})
const logger = createLogger({ service: 'worker', level: 'error' })
const asSystem = <T>(fn: (tx: Tx) => Promise<T>) => uow.runAsSystem('test', fn)

const smtp = (over: Partial<SmtpConfig> = {}): SmtpConfig => ({
  host: 'smtp.piattaforma.example',
  port: 587,
  security: 'starttls',
  username: 'invii@piattaforma.example',
  from: 'avvisi@piattaforma.example',
  ...over,
})
const SECRET = 'parola-segreta-della-piattaforma'

const rawRows = () =>
  withScope(tdb.runtimeUrl, { kind: 'system' }, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>('select * from integrations')
    return rows
  })

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'test' })
  uow = createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger })
  ;({ orgA, ownerA } = await seed(tdb.runtimeUrl, async (s) => {
    const a = await s.organization()
    const owner = await s.user()
    await s.member(a, owner, 'owner')
    return { orgA: a, ownerA: owner }
  }))
}, 120_000)
afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

test('nothing configured: no settings and no credentials', async () => {
  expect(await asSystem((tx) => store.getPlatform(tx, 'smtp'))).toBeNull()
  expect(await asSystem((tx) => store.platformCredentials(tx, 'smtp'))).toBeNull()
})

test('the platform SMTP is stored in the system scope; the view never holds the secret', async () => {
  const view = await asSystem((tx) =>
    store.replacePlatform(tx, 'smtp', {
      config: smtp({ host: 'SMTP.Piattaforma.example', port: 465, security: 'tls' }),
      secret: SECRET,
      updatedBy: null,
    }),
  )
  expect(view).toMatchObject({ kind: 'smtp', secretSet: true, verifiedAt: null, updatedBy: null })
  expect(view.config.host).toBe('smtp.piattaforma.example')
  expect(JSON.stringify(view)).not.toContain('parola')
  expect(await asSystem((tx) => store.platformCredentials(tx, 'smtp'))).toEqual({
    kind: 'smtp',
    config: view.config,
    secret: SECRET,
  })
})

test('at rest: sealed with the platform key, no hint column, nothing of the secret in clear', async () => {
  const [row] = await rawRows()
  expect(row).not.toHaveProperty('secret_hint')
  expect(row?.['secret_enc']).toMatch(/^v1\.1\./)
  expect(row?.['key_version']).toBe(1)
  expect(JSON.stringify(row)).not.toContain('parola')
  // another installation's key does not open it
  const other = createIntegrationStore({
    keyRing: createKeyRing({ platformKey: randomBytes(32), clock: fixedClock(new Date()) }),
  })
  await expect(asSystem((tx) => other.platformCredentials(tx, 'smtp'))).rejects.toThrow()
})

test('an agency transaction neither sees nor writes the platform SMTP', async () => {
  const scope = { organizationId: orgA, userId: ownerA }
  expect(await uow.run(scope, (tx) => store.getPlatform(tx, 'smtp'))).toBeNull()
  expect(await uow.run(scope, (tx) => store.platformCredentials(tx, 'smtp'))).toBeNull()
  const refused = await uow
    .run(scope, (tx) =>
      store.replacePlatform(tx, 'smtp', {
        config: smtp(),
        secret: 'altra-parola',
        updatedBy: ownerA,
      }),
    )
    .catch((e: unknown) => e)
  expect(String((refused as { cause?: unknown }).cause)).toMatch(/row-level security/)
  expect(await asSystem((tx) => store.platformCredentials(tx, 'smtp'))).toMatchObject({
    secret: SECRET,
  })
})

test('replacing keeps one row, resets the verification and changes the secret', async () => {
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query('update integrations set verified_at = now()'),
  )
  const view = await asSystem((tx) =>
    store.replacePlatform(tx, 'smtp', {
      config: smtp({ port: 2525 }),
      secret: 'nuova-parola-della-piattaforma',
      updatedBy: ownerA,
    }),
  )
  expect(view).toMatchObject({ verifiedAt: null, updatedBy: ownerA, config: { port: 2525 } })
  expect(await rawRows()).toHaveLength(1)
  expect((await asSystem((tx) => store.platformCredentials(tx, 'smtp')))?.secret).toBe(
    'nuova-parola-della-piattaforma',
  )
})

test.each([
  ['a port outside 465, 587, 2525', { port: 25 }],
  ['implicit TLS on 587', { port: 587, security: 'tls' }],
  ['STARTTLS on 465', { port: 465, security: 'starttls' }],
  ['an IP address as host', { host: '10.0.0.1' }],
  ['a host with a port', { host: 'smtp.example.com:25' }],
  ['a sender with a display name', { from: 'Feedway <avvisi@piattaforma.example>' }],
  ['a sender with a line break', { from: 'a@b.example\r\nBcc: x@y.example' }],
  ['two senders', { from: 'a@b.example,c@d.example' }],
  ['a username with a line break', { username: 'a\r\nb' }],
] as [string, Partial<SmtpConfig>][])('settings with %s are refused', async (_, over) => {
  await expect(
    asSystem((tx) =>
      store.replacePlatform(tx, 'smtp', {
        config: smtp(over),
        secret: 'una-parola',
        updatedBy: null,
      }),
    ),
  ).rejects.toMatchObject({ code: 'VALIDATION' })
})

test('an empty, control-character or oversized secret is refused, and the error never holds it', async () => {
  for (const secret of ['', 'parola\r\nsegreta', 'x'.repeat(1025)]) {
    const error = await asSystem((tx) =>
      store.replacePlatform(tx, 'smtp', { config: smtp(), secret, updatedBy: null }),
    ).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'VALIDATION' })
    if (secret.length > 0) expect((error as Error).message).not.toContain(secret)
  }
})

test('a successful test marks only the version it tried, and leaves updatedAt as it is', async () => {
  const tried = await asSystem((tx) =>
    store.replacePlatform(tx, 'smtp', { config: smtp(), secret: SECRET, updatedBy: null }),
  )
  const at = new Date()
  // settings changed while the email was leaving: nothing is marked
  expect(
    await asSystem((tx) =>
      tx.integrations.markPlatformVerified('smtp', at, new Date(tried.updatedAt.getTime() - 1)),
    ),
  ).toBe(false)
  expect((await asSystem((tx) => store.getPlatform(tx, 'smtp')))?.verifiedAt).toBeNull()
  expect(
    await asSystem((tx) => tx.integrations.markPlatformVerified('smtp', at, tried.updatedAt)),
  ).toBe(true)
  const marked = await asSystem((tx) => store.getPlatform(tx, 'smtp'))
  expect(marked?.verifiedAt?.getTime()).toBe(at.getTime())
  expect(marked?.updatedAt.getTime()).toBe(tried.updatedAt.getTime())
})

test('outside the system scope nothing can be marked verified', async () => {
  const current = await asSystem((tx) =>
    store.replacePlatform(tx, 'smtp', { config: smtp(), secret: SECRET, updatedBy: null }),
  )
  expect(
    await uow.run({ organizationId: orgA, userId: ownerA }, (tx) =>
      tx.integrations.markPlatformVerified('smtp', new Date(), current.updatedAt),
    ),
  ).toBe(false)
  expect((await asSystem((tx) => store.getPlatform(tx, 'smtp')))?.verifiedAt).toBeNull()
})

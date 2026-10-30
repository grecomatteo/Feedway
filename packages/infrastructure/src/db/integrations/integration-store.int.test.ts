import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { SmtpConfig } from '@app/application'
import { createKeyRing } from '../../crypto/key-ring.js'
import { fixedClock, seed, startTestDatabase, withScope } from '../../testing/index.js'
import type { TestDatabase } from '../../testing/index.js'
import { uuidV7Generator } from '../../system/id-generator.js'
import { createDb } from '../client.js'
import type { DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'
import { createIntegrationStore } from './integration-store.js'
import { createLogger } from '../../logging/logger.js'

let tdb: TestDatabase
let handle: DbHandle
let orgA: string, orgB: string, ownerA: string
let store: ReturnType<typeof createIntegrationStore>
const ring = createKeyRing({ platformKey: randomBytes(32), clock: fixedClock(new Date()) })
const logger = createLogger({ service: 'worker', level: 'error' })

const smtp = (over: Partial<SmtpConfig> = {}): SmtpConfig => ({
  host: 'smtp.agenzia.example',
  port: 587,
  security: 'starttls',
  username: 'invii@agenzia.example',
  from: 'avvisi@agenzia.example',
  ...over,
})
const AGENCY_SECRET = 'parola-segreta-della-agenzia'
const PLATFORM_SECRET = 'parola-segreta-della-piattaforma'

const rawRows = () =>
  withScope(tdb.runtimeUrl, { kind: 'system' }, async (c) => {
    const { rows } = await c.query<{
      organization_id: string | null
      config: unknown
      secret_enc: string
      key_version: number
      secret_hint: string
    }>('select organization_id, config, secret_enc, key_version, secret_hint from integrations')
    return rows
  })

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'test' })
  ;({ orgA, orgB, ownerA } = await seed(tdb.runtimeUrl, async (s) => {
    const a = await s.organization()
    const b = await s.organization()
    const owner = await s.user()
    await s.member(a, owner, 'owner')
    return { orgA: a, orgB: b, ownerA: owner }
  }))
  const uow = createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger })
  for (const o of [orgA, orgB])
    await uow.runAsSystem('test', (tx) => ring.createOrganizationKey(tx, o))
  store = createIntegrationStore({ db: handle.db, keyRing: ring, ids: uuidV7Generator, logger })
}, 120_000)
afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

test('nothing configured: no settings and no credentials, for an agency or the platform', async () => {
  expect(await store.get(orgA, 'smtp')).toBeNull()
  expect(await store.get(null, 'smtp')).toBeNull()
  expect(await store.credentials(orgA, 'smtp')).toBeNull()
})

test('the platform default serves every agency without its own settings', async () => {
  const view = await store.replace(null, 'smtp', {
    config: smtp({ host: 'SMTP.Piattaforma.example', port: 465, security: 'tls' }),
    secret: PLATFORM_SECRET,
    updatedBy: null,
  })
  expect(view).toMatchObject({ owner: 'platform', secretHint: 'orma', verifiedAt: null })
  expect(view.config.host).toBe('smtp.piattaforma.example')
  expect(view).not.toHaveProperty('secret')
  expect(await store.get(orgB, 'smtp')).toMatchObject({ owner: 'platform' })
  expect(await store.credentials(orgB, 'smtp')).toMatchObject({
    owner: 'platform',
    secret: PLATFORM_SECRET,
  })
  expect(await store.credentials(null, 'smtp')).toMatchObject({ secret: PLATFORM_SECRET })
})

test('an agency with its own settings uses them; the others keep the default', async () => {
  const view = await store.replace(orgA, 'smtp', {
    config: smtp(),
    secret: AGENCY_SECRET,
    updatedBy: ownerA,
  })
  expect(view).toMatchObject({ owner: 'organization', secretHint: 'nzia', updatedBy: ownerA })
  expect(await store.credentials(orgA, 'smtp')).toEqual({
    kind: 'smtp',
    owner: 'organization',
    config: smtp(),
    secret: AGENCY_SECRET,
  })
  expect((await store.credentials(orgB, 'smtp'))?.owner).toBe('platform')
  // security emails ask for the platform: never an agency's server
  expect((await store.credentials(null, 'smtp'))?.secret).toBe(PLATFORM_SECRET)
})

test('the secret is sealed at rest with the agency key, bound to its row, and only a hint shows', async () => {
  const rows = await rawRows()
  const own = rows.find((r) => r.organization_id === orgA)
  expect(own?.secret_enc).toMatch(/^v1\.1\./)
  expect(own?.key_version).toBe(1)
  expect(own?.secret_hint).toBe('nzia')
  for (const r of rows) {
    expect(JSON.stringify(r.config)).not.toContain('parola')
    expect(r.secret_enc).not.toContain('parola')
  }
  // a sealed value copied onto another agency's row does not open there
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query(
      `insert into integrations (id, organization_id, kind, config, secret_enc, key_version, secret_hint)
       select $1, $2, kind, config, secret_enc, key_version, secret_hint from integrations
        where organization_id = $3`,
      [randomUUID(), orgB, orgA],
    ),
  )
  await expect(store.credentials(orgB, 'smtp')).rejects.toThrow()
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query('delete from integrations where organization_id = $1', [orgB]),
  )
})

test('replacing keeps one row, resets the verification and changes the secret', async () => {
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query('update integrations set verified_at = now() where organization_id = $1', [orgA]),
  )
  const view = await store.replace(orgA, 'smtp', {
    config: smtp({ port: 2525 }),
    secret: 'nuova-parola-della-agenzia',
    updatedBy: ownerA,
  })
  expect(view).toMatchObject({ verifiedAt: null, config: { port: 2525 } })
  expect((await rawRows()).filter((r) => r.organization_id === orgA)).toHaveLength(1)
  expect((await store.credentials(orgA, 'smtp'))?.secret).toBe('nuova-parola-della-agenzia')
})

test.each([
  ['a port outside 465, 587, 2525', { port: 25 }],
  ['implicit TLS on 587', { port: 587, security: 'tls' }],
  ['STARTTLS on 465', { port: 465, security: 'starttls' }],
  ['an IP address as host', { host: '10.0.0.1' }],
  ['a host with a port', { host: 'smtp.example.com:25' }],
  ['a sender with a display name', { from: 'Feedway <avvisi@agenzia.example>' }],
  ['a sender with a line break', { from: 'a@b.example\r\nBcc: x@y.example' }],
  ['two senders', { from: 'a@b.example,c@d.example' }],
  ['a username with a line break', { username: 'a\r\nb' }],
] as [string, Partial<SmtpConfig>][])('settings with %s are refused', async (_, over) => {
  await expect(
    store.replace(orgB, 'smtp', { config: smtp(over), secret: 'una-parola', updatedBy: null }),
  ).rejects.toMatchObject({ code: 'VALIDATION' })
})

test('an empty or control-character secret is refused, and the error never holds it', async () => {
  for (const secret of ['', 'parola\r\nsegreta', 'x'.repeat(1025)]) {
    const error = await store
      .replace(orgB, 'smtp', { config: smtp(), secret, updatedBy: null })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'VALIDATION' })
    if (secret.length > 0) expect((error as Error).message).not.toContain(secret)
  }
})

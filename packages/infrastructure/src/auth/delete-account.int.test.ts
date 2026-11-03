import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  anonymizeUser,
  createAuthEventSink,
  deleteMyAccount,
  resolveSessionUser,
  type AnonymizeDeps,
  type Auth,
  type AuthSessionInfo,
  type JobQueue,
  type Storage,
  type UnitOfWork,
  type UserAnonymizedEvent,
} from '@app/application'
import { DomainError } from '@app/domain'
import { createDb, type Db } from '../db/client.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createPasswordHasher } from '../crypto/password-hasher.js'
import { createSignedTokens } from '../crypto/signed-tokens.js'
import { createPgRateLimiter } from '../db/rate-limiter.js'
import { createLogger } from '../logging/logger.js'
import { createLocalDiskStorage } from '../storage/local-disk-storage.js'
import { systemClock } from '../system/clock.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { seed, startTestDatabase, type TestDatabase } from '../testing/index.js'
import { createAuthAdapter } from './auth-adapter.js'
import { createBetterAuth, type BetterAuthInstance } from './better-auth.js'

const PANEL = 'https://app.feedway.test'
// low entropy on purpose: made-up values, not secrets for the leak scanner
const PASSWORD = 'cavallo-batteria-graffetta-lago'
const IP = '192.0.2.44'

let tdb: TestDatabase
let admin: pg.Client
let db: Db
let instance: BetterAuthInstance
let auth: Auth
let uow: UnitOfWork
let storage: Storage
let root: string
let orgA: string
let orgB: string
let ownerA: string
const logger = createLogger({ service: 'web', level: 'error' })
const handled: UserAnonymizedEvent[] = []

const queue: JobQueue = {
  send: () => Promise.resolve(null),
  work: () => Promise.reject(new Error('not used')),
  ping: () => Promise.resolve(),
  stop: () => Promise.resolve(),
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  db = createDb(tdb.runtimeUrl, { max: 6, applicationName: 'delete-account-test' }).db
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  root = await mkdtemp(join(tmpdir(), 'delete-account-test-'))
  storage = createLocalDiskStorage({ root })
  uow = createUnitOfWork({ db, ids: uuidV7Generator, logger })
  const secret = randomBytes(32).toString('hex')
  instance = createBetterAuth({
    db,
    config: {
      panelUrl: PANEL,
      productName: 'Feedway',
      secret,
      secrets: [{ version: 1, value: secret }],
    },
    ids: uuidV7Generator,
    clock: systemClock,
    hasher: createPasswordHasher(),
    rateLimiter: createPgRateLimiter({ db, clock: systemClock }),
    logger,
    queue,
    events: createAuthEventSink({
      uow,
      queue,
      tokens: createSignedTokens(randomBytes(32)),
      clock: systemClock,
      logger,
    }),
    resolveSessionUser: (session) =>
      resolveSessionUser({ uow, config: { require2fa: 'admins' } }, session),
  })
  auth = createAuthAdapter(instance, { db, clock: systemClock })
  await seed(tdb.runtimeUrl, async (s) => {
    orgA = await s.organization()
    orgB = await s.organization()
  })
  await admin.query(`update organizations set name = 'Agenzia A' where id = $1`, [orgA])
  ownerA = (await person('owner')).id
  await admin.query(
    `insert into organization_members (organization_id, user_id, role) values ($1, $2, 'owner')`,
    [orgA, ownerA],
  )
})
afterAll(async () => {
  await admin.end()
  await tdb.stop()
  await rm(root, { recursive: true, force: true })
})

const deps = (overrides: Partial<AnonymizeDeps> = {}): AnonymizeDeps => ({
  uow,
  clock: systemClock,
  auth,
  storage,
  logger,
  onUserAnonymized: [
    (event) => {
      handled.push(event)
      return Promise.resolve()
    },
  ],
  ...overrides,
})

/** A session confirmed with the password just now, or long ago. */
const sessionOf = (userId: string, fresh = true): AuthSessionInfo => ({
  id: randomUUID(),
  userId,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3600_000),
  updatedAt: new Date(),
  ipAddress: IP,
  userAgent: null,
  authMethod: 'password',
  reauthenticatedAt: fresh ? new Date() : new Date(Date.now() - 3600_000),
})

async function person(prefix = 'persona') {
  const id = randomUUID()
  const email = `${prefix}-${id.slice(0, 8)}@esempio.it`
  await auth.createUser({ id, email, name: 'Anna Rossi', password: PASSWORD })
  return { id, email }
}

/** A member of agency A with every kind of personal data the deletion must reach. */
async function memberWithData() {
  const member = await person()
  const id = member.id
  const workspace = randomUUID()
  await admin.query(
    `insert into organization_members (organization_id, user_id, role) values ($1, $2, 'member')`,
    [orgA, id],
  )
  await admin.query(
    `insert into workspaces (id, organization_id, name, slug) values ($1, $2, 'Bar Sport', $3)`,
    [workspace, orgA, workspace],
  )
  await admin.query(
    `insert into workspace_members (organization_id, workspace_id, user_id, role)
     values ($1, $2, $3, 'editor')`,
    [orgA, workspace, id],
  )
  await admin.query(
    `update users set nickname = 'Annina', timezone = 'Europe/Rome', image = 'x',
       avatar_key = $2 where id = $1`,
    [id, `users/${id}/avatar/abc`],
  )
  await admin.query(
    `insert into two_factors (id, secret, backup_codes, user_id) values ($1, 'S', 'B', $2)`,
    [randomUUID(), id],
  )
  await admin.query(
    `insert into passkeys (id, name, public_key, user_id, credential_id, counter, device_type,
                           backed_up, created_at)
     values ($1, 'Portatile', 'pk', $2, $3, 0, 'multiDevice', true, now())`,
    [randomUUID(), id, randomUUID()],
  )
  await admin.query(`insert into known_devices (user_id, device_hash) values ($1, '\\xbeef')`, [id])
  await admin.query(`insert into data_exports (id, user_id, status) values ($1, $2, 'ready')`, [
    randomUUID(),
    id,
  ])
  // pending links: one by id, one by address; the other address only looks alike
  await admin.query(
    `insert into verifications (id, identifier, value, expires_at) values
       ($1, 'reset-password:abc', $4, now() + interval '1 hour'),
       ($2, $5, 'x', now() + interval '1 hour'),
       ($3, $6, 'x', now() + interval '1 hour')`,
    [randomUUID(), randomUUID(), randomUUID(), id, member.email, `x${member.email}`],
  )
  // an invite to the same address, for another agency role, still open
  await admin.query(
    `insert into invites (id, organization_id, purpose, email, token_hash, org_role, expires_at)
     values ($1, $2, 'invite', $3, $4, 'member', now() + interval '1 day')`,
    [randomUUID(), orgA, member.email, randomBytes(32)],
  )
  await storage.put(`users/${id}/avatar/abc`, Buffer.from('foto'), { contentType: 'image/webp' })
  await storage.put(`users/${id}/exports/e.zip`, Buffer.from('zip'), {
    contentType: 'application/zip',
  })
  expect((await signIn(member.email)).status).toBe(200)
  return member
}

function signIn(email: string, password = PASSWORD) {
  const ip = `10.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250))}.1`
  return instance.handler(
    new Request(`${PANEL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: PANEL, 'x-app-client-ip': ip },
      body: JSON.stringify({ email, password }),
    }),
  )
}

async function countRows(table: string, userId: string) {
  // the table names are fixed in the tests below
  const { rows } = await admin.query<{ n: number }>(
    `select count(*)::int as n from ${table} where user_id = $1`,
    [userId],
  )
  return rows[0]?.n ?? 0
}

async function rawUser(id: string) {
  const { rows } = await admin.query<Record<string, unknown>>(
    `select name, email, nickname, image, avatar_key, timezone, status, two_factor_enabled,
            disabled_at, anonymized_at from users where id = $1`,
    [id],
  )
  return rows[0]
}

async function anonymizedEntries(userId: string) {
  const { rows } = await admin.query<{
    organization_id: string | null
    actor_id: string | null
    source: string
  }>(
    `select organization_id, actor_id, source from audit_log
      where action = 'user.anonymized' and entity_id = $1 order by organization_id nulls first`,
    [userId],
  )
  return rows
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    if (error instanceof DomainError) return error.code
    throw error
  }
  return 'OK'
}

test('deleting removes credentials, files and devices and anonymizes the person', async () => {
  const member = await memberWithData()
  const id = member.id
  await deleteMyAccount(deps(), { id }, sessionOf(id), { ip: IP })

  for (const table of [
    'sessions',
    'accounts',
    'two_factors',
    'passkeys',
    'known_devices',
    'data_exports',
  ])
    expect(await countRows(table, id), table).toBe(0)
  expect(await storage.list(`users/${id}/`)).toEqual([])
  const { rows: pending } = await admin.query<{ identifier: string }>(
    'select identifier from verifications where value = $1 or identifier like $2',
    [id, `%${member.email}`],
  )
  expect(pending.map((p) => p.identifier)).toEqual([`x${member.email}`])
  expect(await rawUser(id)).toMatchObject({
    name: 'Utente rimosso',
    email: `${id}@utente-rimosso.invalid`,
    nickname: null,
    image: null,
    avatar_key: null,
    timezone: null,
    status: 'disabled',
    two_factor_enabled: false,
  })
  expect((await rawUser(id))?.anonymized_at).not.toBeNull()
  expect((await signIn(member.email)).status).not.toBe(200)

  const { rows: memberships } = await admin.query<{ status: string }>(
    'select status from organization_members where user_id = $1',
    [id],
  )
  expect(memberships).toEqual([{ status: 'disabled' }])
  expect(await countRows('workspace_members', id)).toBe(0)
  const { rows: invites } = await admin.query<{ open: boolean }>(
    'select expires_at > now() as open from invites where email = $1',
    [member.email],
  )
  expect(invites).toEqual([{ open: false }])
  expect(await anonymizedEntries(id)).toEqual([
    { organization_id: null, actor_id: id, source: 'panel' },
    { organization_id: orgA, actor_id: id, source: 'panel' },
  ])
})

test('requires a recent reauth', async () => {
  const { id } = await person()
  expect(await codeOf(deleteMyAccount(deps(), { id }, sessionOf(id, false), { ip: IP }))).toBe(
    'REAUTH_REQUIRED',
  )
  expect((await rawUser(id))?.status).toBe('active')
})

test('the owner of an agency cannot delete the account, and keeps every credential', async () => {
  const refused = deleteMyAccount(deps(), { id: ownerA }, sessionOf(ownerA), { ip: IP })
  await expect(refused).rejects.toMatchObject({
    code: 'SOLE_OWNER',
    message: expect.stringContaining('Sei l’Owner di Agenzia A') as unknown,
  })
  expect(await countRows('accounts', ownerA)).toBe(1)
  expect((await rawUser(ownerA))?.status).toBe('active')
})

test('the platform administrator cannot delete the account from the panel', async () => {
  const { id } = await person('piattaforma')
  await admin.query(`update users set platform_role = 'admin' where id = $1`, [id])
  expect(await codeOf(deleteMyAccount(deps(), { id }, sessionOf(id), { ip: IP }))).toBe('FORBIDDEN')
  expect(await countRows('accounts', id)).toBe(1)
})

test('an interrupted anonymization completes when run again, recording it once', async () => {
  const member = await memberWithData()
  await admin.query(
    `insert into organization_members (organization_id, user_id, role) values ($1, $2, 'member')`,
    [orgB, member.id],
  )
  // the run stops in the second agency, after the first one is done
  let agencies = 0
  const failing = deps({
    uow: {
      ...uow,
      run: (scope, fn) =>
        'organizationId' in scope && ++agencies === 2
          ? Promise.reject(new Error('database non raggiungibile'))
          : uow.run(scope, fn),
    },
  })
  await expect(anonymizeUser(failing, { userId: member.id, source: 'panel' })).rejects.toThrow()
  // already closed: no credential is left, and the account is disabled
  expect(await countRows('accounts', member.id)).toBe(0)
  expect((await rawUser(member.id))?.status).toBe('disabled')
  expect((await signIn(member.email)).status).not.toBe(200)

  handled.length = 0
  await anonymizeUser(deps(), { userId: member.id, source: 'panel' })
  await anonymizeUser(deps(), { userId: member.id, source: 'panel' })
  expect((await rawUser(member.id))?.anonymized_at).not.toBeNull()
  expect(await storage.list(`users/${member.id}/`)).toEqual([])
  // one entry per agency and one personal, however many runs
  expect((await anonymizedEntries(member.id)).map((e) => e.organization_id).sort()).toEqual(
    [null, orgA, orgB].sort(),
  )
  // the modules' handlers run on every run
  expect(handled).toEqual([
    { userId: member.id, source: 'panel' },
    { userId: member.id, source: 'panel' },
  ])
})

test('the freed address can belong to a new person', async () => {
  const member = await person()
  await deleteMyAccount(deps(), { id: member.id }, sessionOf(member.id), { ip: IP })
  const newcomer = randomUUID()
  await auth.createUser({ id: newcomer, email: member.email, name: 'Nuova', password: PASSWORD })
  expect((await signIn(member.email)).status).toBe(200)
  expect((await rawUser(newcomer))?.status).toBe('active')
})

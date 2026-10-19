import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  createAuthEventSink,
  resolveSession,
  type Auth,
  type IdentityDeps,
  type JobQueue,
} from '@app/application'
import type { AuthMethod, OrgRole } from '@app/domain'
import { createDb } from '../db/client.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createPasswordHasher } from '../crypto/password-hasher.js'
import { createSignedTokens } from '../crypto/signed-tokens.js'
import { createPgRateLimiter } from '../db/rate-limiter.js'
import { createLogger } from '../logging/logger.js'
import { systemClock } from '../system/clock.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { seed, startTestDatabase, type TestDatabase } from '../testing/index.js'
import { createAuthAdapter } from './auth-adapter.js'
import { createBetterAuth, type BetterAuthInstance } from './better-auth.js'

const PANEL = 'https://app.feedway.test'
// low entropy on purpose: a made-up value, not a secret for the leak scanner
const PASSWORD = 'cavallo-batteria-graffetta-lago'

let tdb: TestDatabase
let admin: pg.Client
let instance: BetterAuthInstance
let auth: Auth
let deps: Pick<IdentityDeps, 'uow' | 'auth' | 'config'>
const logger = createLogger({ service: 'web', level: 'error' })

const noQueue: JobQueue = {
  send: () => Promise.resolve(null),
  work: () => Promise.reject(new Error('not used')),
  ping: () => Promise.resolve(),
  stop: () => Promise.resolve(),
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  const { db } = createDb(tdb.runtimeUrl, { max: 5, applicationName: 'sessions-test' })
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  const uow = createUnitOfWork({ db, ids: uuidV7Generator, logger })
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
    events: createAuthEventSink({
      uow,
      queue: noQueue,
      tokens: createSignedTokens(randomBytes(32)),
      clock: systemClock,
      logger,
    }),
  })
  auth = createAuthAdapter(instance, { db, clock: systemClock })
  deps = {
    uow,
    auth,
    config: {
      require2fa: 'admins',
      bootstrapOwnerEmail: null,
      bootstrapOrganizationName: '',
      panelUrl: PANEL,
    },
  }
})
afterAll(async () => {
  await admin.end()
  await tdb.stop()
})

/** A person with a password and the given memberships; returns the id and a signed-in cookie. */
async function person(
  memberships: { organizationId: string; role: OrgRole; status?: 'active' | 'disabled' }[] = [],
) {
  const id = randomUUID()
  const email = `persona-${id.slice(0, 8)}@esempio.it`
  await auth.createUser({ id, email, name: 'Anna Rossi', password: PASSWORD })
  for (const m of memberships)
    await seed(tdb.runtimeUrl, (s) => s.member(m.organizationId, id, m.role, m.status))
  return { id, email, headers: await signIn(email) }
}

async function signIn(email: string): Promise<Headers> {
  const res = await instance.handler(
    new Request(`${PANEL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: PANEL,
        'x-app-client-ip': `10.8.${String(Math.floor(Math.random() * 250))}.1`,
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  )
  expect(res.status).toBe(200)
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  return new Headers({ cookie })
}

/** The session of these headers, as if it had been opened with another method. */
async function withMethod(userId: string, method: AuthMethod) {
  await admin.query('update sessions set auth_method = $2 where user_id = $1', [userId, method])
}

async function addPasskey(userId: string) {
  await admin.query(
    `insert into passkeys (id, public_key, user_id, credential_id, counter, device_type, backed_up)
     values ($1, 'chiave', $2, $3, 0, 'singleDevice', false)`,
    [randomUUID(), userId, randomUUID()],
  )
}

async function agency(opts?: { require2fa?: 'all' | 'admins'; status?: 'suspended' }) {
  const id = await seed(tdb.runtimeUrl, (s) =>
    s.organization(opts?.status ? { status: opts.status } : {}),
  )
  if (opts?.require2fa)
    await admin.query('update organizations set settings = $2 where id = $1', [
      id,
      { require2fa: opts.require2fa },
    ])
  return id
}

test('no cookie, no session', async () => {
  expect(await resolveSession(deps, { headers: new Headers() })).toBeNull()
})

test('org admin signed in with password only must add a second factor', async () => {
  const org = await agency()
  const { headers } = await person([{ organizationId: org, role: 'admin' }])
  const r = await resolveSession(deps, { headers })
  expect(r?.state).toBe('second_factor_required')
  expect(r?.user.secondFactor).toEqual({ required: true, totpEnabled: false, passkeys: 0 })
})

test('passkey session satisfies the requirement, password plus totp too', async () => {
  const org = await agency()
  for (const method of ['passkey', 'password_totp', 'password_backup_code'] as const) {
    const p = await person([{ organizationId: org, role: 'admin' }])
    await withMethod(p.id, method)
    expect((await resolveSession(deps, { headers: p.headers }))?.state).toBe('active')
  }
})

test('org admin with a passkey who signs in with the password alone is stuck in second_factor_required', async () => {
  const org = await agency()
  const p = await person([{ organizationId: org, role: 'admin' }])
  await addPasskey(p.id)
  const r = await resolveSession(deps, { headers: p.headers })
  expect(r?.state).toBe('second_factor_required')
  expect(r?.user.secondFactor).toMatchObject({ totpEnabled: false, passkeys: 1 })
})

test('a member needs no second factor, unless the agency or the platform asks it of everyone', async () => {
  const relaxed = await agency()
  const strict = await agency({ require2fa: 'all' })
  const member = await person([{ organizationId: relaxed, role: 'member' }])
  expect((await resolveSession(deps, { headers: member.headers }))?.state).toBe('active')
  const strictMember = await person([{ organizationId: strict, role: 'member' }])
  expect((await resolveSession(deps, { headers: strictMember.headers }))?.state).toBe(
    'second_factor_required',
  )
  const platformAll = { ...deps, config: { ...deps.config, require2fa: 'all' as const } }
  expect((await resolveSession(platformAll, { headers: member.headers }))?.state).toBe(
    'second_factor_required',
  )
})

test('a disabled membership does not count, and is not listed', async () => {
  const org = await agency()
  const p = await person([{ organizationId: org, role: 'owner', status: 'disabled' }])
  const r = await resolveSession(deps, { headers: p.headers })
  expect(r?.state).toBe('active')
  expect(r?.user.organizations).toEqual([])
})

test('the session user carries the profile, the agencies and the last one opened', async () => {
  const a = await agency()
  const b = await agency({ status: 'suspended' })
  const p = await person([
    { organizationId: a, role: 'member' },
    { organizationId: b, role: 'member' },
  ])
  await admin.query(
    "update users set nickname = 'Annina', last_organization_id = $2 where id = $1",
    [p.id, a],
  )
  const r = await resolveSession(deps, { headers: p.headers })
  expect(r?.user).toMatchObject({
    id: p.id,
    email: p.email,
    displayName: 'Annina',
    platformRole: null,
    avatarUrl: null,
    theme: 'system',
    lastOrganizationSlug: a,
  })
  expect(r?.user.organizations).toHaveLength(2)
  expect(r?.user.organizations.find((o) => o.id === b)).toMatchObject({
    status: 'suspended',
    role: 'member',
  })
  expect(r?.session.userId).toBe(p.id)
})

test('disabled user session stops resolving and is revoked', async () => {
  const p = await person()
  await signIn(p.email) // a second device
  await admin.query("update users set status = 'disabled', disabled_at = now() where id = $1", [
    p.id,
  ])
  expect(await resolveSession(deps, { headers: p.headers })).toBeNull()
  const left = await admin.query('select 1 from sessions where user_id = $1', [p.id])
  expect(left.rowCount).toBe(0)
})

test('anonymized user session stops resolving and is revoked', async () => {
  const p = await person()
  await admin.query('update users set anonymized_at = now() where id = $1', [p.id])
  expect(await resolveSession(deps, { headers: p.headers })).toBeNull()
  const left = await admin.query('select 1 from sessions where user_id = $1', [p.id])
  expect(left.rowCount).toBe(0)
})

test('a session older than 30 days stops resolving', async () => {
  const p = await person()
  await admin.query(
    "update sessions set created_at = now() - interval '31 days' where user_id = $1",
    [p.id],
  )
  expect(await resolveSession(deps, { headers: p.headers })).toBeNull()
})

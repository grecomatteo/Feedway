import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  assertRecentReauth,
  createAuthEventSink,
  resolveSessionUser,
  listMySessions,
  reauthenticate,
  resolveSession,
  revokeAllMySessions,
  revokeMySession,
  type Auth,
  type AuthEventSink,
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
import {
  newSoftPasskey,
  passkeySignIn as signInWithPasskey,
  storedColumns,
  type SoftPasskey,
} from '../testing/soft-passkey.js'
import { createAuthAdapter } from './auth-adapter.js'
import { createBetterAuth, type BetterAuthInstance } from './better-auth.js'

const PANEL = 'https://app.feedway.test'
// low entropy on purpose: a made-up value, not a secret for the leak scanner
const PASSWORD = 'cavallo-batteria-graffetta-lago'

let tdb: TestDatabase
let admin: pg.Client
let instance: BetterAuthInstance
let auth: Auth
let deps: Pick<IdentityDeps, 'uow' | 'auth' | 'config' | 'clock' | 'rateLimiter'>
let sink: AuthEventSink
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
  const rateLimiter = createPgRateLimiter({ db, clock: systemClock })
  sink = createAuthEventSink({
    uow,
    queue: noQueue,
    tokens: createSignedTokens(randomBytes(32)),
    clock: systemClock,
    logger,
  })
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
    rateLimiter,
    logger,
    events: sink,
    resolveSessionUser: (session) =>
      resolveSessionUser({ uow, config: { require2fa: 'admins' } }, session),
  })
  auth = createAuthAdapter(instance, { db, clock: systemClock })
  deps = {
    uow,
    auth,
    clock: systemClock,
    rateLimiter,
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

test('a platform admin with no agency still needs a second factor', async () => {
  const p = await person()
  await admin.query("update users set platform_role = 'admin' where id = $1", [p.id])
  const r = await resolveSession(deps, { headers: p.headers })
  expect(r?.user.organizations).toEqual([])
  expect(r?.state).toBe('second_factor_required')
})

test('an activation session is not a second factor', async () => {
  const org = await agency()
  const p = await person([{ organizationId: org, role: 'admin' }])
  await withMethod(p.id, 'activation')
  expect((await resolveSession(deps, { headers: p.headers }))?.state).toBe('second_factor_required')
})

test('an unreadable agency policy asks everyone for a second factor', async () => {
  const org = await agency()
  await admin.query('update organizations set settings = $2 where id = $1', [
    org,
    { require2fa: 'ALL' },
  ])
  const p = await person([{ organizationId: org, role: 'member' }])
  expect((await resolveSession(deps, { headers: p.headers }))?.state).toBe('second_factor_required')
})

test('a suspended last agency is not offered as the one to open', async () => {
  const org = await agency({ status: 'suspended' })
  const p = await person([{ organizationId: org, role: 'member' }])
  await admin.query('update users set last_organization_id = $2 where id = $1', [p.id, org])
  const r = await resolveSession(deps, { headers: p.headers })
  expect(r?.user.lastOrganizationSlug).toBeNull()
})

/** The ids of a person's sessions, oldest first. */
async function sessionIds(userId: string): Promise<string[]> {
  const { rows } = await admin.query<{ id: string }>(
    'select id from sessions where user_id = $1 order by created_at, id',
    [userId],
  )
  return rows.map((r) => r.id)
}

async function auditOf(userId: string, action: string) {
  const { rows } = await admin.query<{ entity_id: string | null; data: Record<string, unknown> }>(
    'select entity_id, data from audit_log where actor_id = $1 and action = $2',
    [userId, action],
  )
  return rows
}

const minutes = (n: number) => n * 60_000

async function reauthenticatedAt(sessionId: string): Promise<Date | null | undefined> {
  const { rows } = await admin.query<{ reauthenticated_at: Date | null }>(
    'select reauthenticated_at from sessions where id = $1',
    [sessionId],
  )
  return rows[0]?.reauthenticated_at
}

function at(ids: string[], index: number): string {
  const id = ids[index]
  if (id === undefined) throw new Error(`no session at ${String(index)}`)
  return id
}

async function resolved(headers: Headers) {
  const r = await resolveSession(deps, { headers })
  if (!r) throw new Error('no session')
  return r
}
const request = { ip: '93.41.12.200' }

test('password reauth opens a ten-minute window', async () => {
  const p = await person()
  const before = await resolved(p.headers)
  expect(() => {
    assertRecentReauth(before.session, new Date())
  }).toThrow(expect.objectContaining({ code: 'REAUTH_REQUIRED' }))
  await reauthenticate(deps, before.session, { password: PASSWORD }, request)
  const after = (await resolved(p.headers)).session
  const now = new Date()
  expect(() => {
    assertRecentReauth(after, now)
  }).not.toThrow()
  expect(() => {
    assertRecentReauth(after, new Date(now.getTime() + minutes(11)))
  }).toThrow(expect.objectContaining({ code: 'REAUTH_REQUIRED' }))
  expect(await auditOf(p.id, 'auth.reauthenticated')).toEqual([
    { entity_id: after.id, data: { method: 'password' } },
  ])
})

test('wrong password on reauth is refused, and the sixth try is limited', async () => {
  const p = await person()
  const { session } = await resolved(p.headers)
  for (let i = 0; i < 5; i++)
    await expect(
      reauthenticate(deps, session, { password: 'sbagliata-di-sicuro' }, request),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED', message: 'Password non corretta' })
  // the right password does not help once the window is used up
  await expect(
    reauthenticate(deps, session, { password: PASSWORD }, request),
  ).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  const { session: still } = await resolved(p.headers)
  expect(still.reauthenticatedAt).toBeNull()
})

test('a person without a password gets the same refusal', async () => {
  const id = randomUUID()
  await auth.createUser({
    id,
    email: `senza-${id.slice(0, 8)}@esempio.it`,
    name: 'Bea',
    password: null,
  })
  const { setCookie } = await auth.openSession(id, {
    ip: null,
    userAgent: null,
    authMethod: 'activation',
  })
  const headers = new Headers({ cookie: setCookie.map((c) => c.split(';')[0]).join('; ') })
  const { session } = await resolved(headers)
  await expect(
    reauthenticate(deps, session, { password: PASSWORD }, request),
  ).rejects.toMatchObject({ code: 'UNAUTHENTICATED', message: 'Password non corretta' })
})

test('a passkey login over a valid session of the same user replaces it with a reauthenticated one', async () => {
  const p = await person()
  await signIn(p.email) // the session the passkey sign-in creates
  const ids = await sessionIds(p.id)
  const before = at(ids, 0)
  const after = at(ids, 1)
  await sink.record(
    {
      kind: 'login',
      userId: p.id,
      sessionId: after,
      method: 'passkey',
      ip: request.ip,
      userAgent: null,
      deviceId: null,
      previousSessionId: before,
    },
    { requestId: null },
  )
  expect(await sessionIds(p.id)).toEqual([after])
  expect(await reauthenticatedAt(after)).not.toBeNull()
  expect(await auditOf(p.id, 'auth.reauthenticated')).toEqual([
    { entity_id: after, data: { method: 'passkey' } },
  ])
})

test('a previous session of someone else is never touched by a login event', async () => {
  const p = await person()
  const other = await person()
  const own = at(await sessionIds(p.id), 0)
  const theirs = at(await sessionIds(other.id), 0)
  await sink.record(
    {
      kind: 'login',
      userId: p.id,
      sessionId: own,
      method: 'passkey',
      ip: null,
      userAgent: null,
      deviceId: null,
      previousSessionId: theirs,
    },
    { requestId: null },
  )
  expect(await sessionIds(other.id)).toEqual([theirs])
  expect(await reauthenticatedAt(own)).toBeNull()
  expect(await auditOf(p.id, 'auth.reauthenticated')).toEqual([])
})

test('only a passkey sign-in turns into a reauth', async () => {
  const p = await person()
  await signIn(p.email)
  const ids = await sessionIds(p.id)
  await sink.record(
    {
      kind: 'login',
      userId: p.id,
      sessionId: at(ids, 1),
      method: 'password',
      ip: null,
      userAgent: null,
      deviceId: null,
      previousSessionId: at(ids, 0),
    },
    { requestId: null },
  )
  expect(await sessionIds(p.id)).toEqual(ids)
  expect(await reauthenticatedAt(at(ids, 1))).toBeNull()
})

test('sessions list marks the current one and never exposes tokens or full ips', async () => {
  const p = await person()
  await signIn(p.email)
  await admin.query(
    "update sessions set ip_address = '93.41.12.200', user_agent = $2 where user_id = $1",
    [
      p.id,
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    ],
  )
  const { session } = await resolved(p.headers)
  const list = await listMySessions(deps, { id: p.id }, session.id)
  expect(list).toHaveLength(2)
  expect(list.filter((s) => s.current).map((s) => s.id)).toEqual([session.id])
  const [shown] = list
  expect(shown).toMatchObject({
    ipApprox: '93.41.12.0',
    device: { browser: 'Safari', os: 'macOS' },
  })
  expect(Object.keys(shown ?? {}).sort()).toEqual(
    ['createdAt', 'current', 'device', 'id', 'ipApprox', 'lastActiveAt'].sort(),
  )
  expect(JSON.stringify(list)).not.toMatch(/token|93\.41\.12\.200/)
})

test('cannot revoke a session of another user', async () => {
  const p = await person()
  const other = await person()
  const theirs = at(await sessionIds(other.id), 0)
  await expect(revokeMySession(deps, { id: p.id }, theirs, request)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  })
  expect(await sessionIds(other.id)).toEqual([theirs])
  expect(await auditOf(p.id, 'session.revoked')).toEqual([])
})

test('a person revokes one of their sessions, or all of them', async () => {
  const p = await person()
  await signIn(p.email)
  await signIn(p.email)
  const [first, ...rest] = await sessionIds(p.id)
  if (first === undefined) throw new Error('no session')
  await revokeMySession(deps, { id: p.id }, first, request)
  expect(await sessionIds(p.id)).toEqual(rest)
  expect(await auditOf(p.id, 'session.revoked')).toEqual([{ entity_id: first, data: {} }])
  expect(await revokeAllMySessions(deps, { id: p.id }, request)).toBe(2)
  expect(await sessionIds(p.id)).toEqual([])
  expect(await auditOf(p.id, 'session.revoked')).toContainEqual({
    entity_id: p.id,
    data: { count: 2 },
  })
})

test('a successful reauth clears the failed attempts', async () => {
  const p = await person()
  const { session } = await resolved(p.headers)
  const wrong = () => reauthenticate(deps, session, { password: 'sbagliata-di-sicuro' }, request)
  for (let i = 0; i < 4; i++)
    await expect(wrong()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  await reauthenticate(deps, session, { password: PASSWORD }, request)
  for (let i = 0; i < 5; i++)
    await expect(wrong()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  await expect(wrong()).rejects.toMatchObject({ code: 'RATE_LIMITED' })
})

test('a malformed session id is a missing session', async () => {
  const p = await person()
  await expect(revokeMySession(deps, { id: p.id }, 'abc', request)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  })
})

test('a reauth on a session revoked meanwhile is refused and not recorded', async () => {
  const p = await person()
  const { session } = await resolved(p.headers)
  await admin.query('delete from sessions where id = $1', [session.id])
  await expect(
    reauthenticate(deps, session, { password: PASSWORD }, request),
  ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  expect(await auditOf(p.id, 'auth.reauthenticated')).toEqual([])
})

// The test's passkeys sign real WebAuthn assertions (testing/soft-passkey.ts), so the real
// endpoint, our hooks and the login event all run.
async function softPasskey(userId: string): Promise<SoftPasskey> {
  const key = newSoftPasskey(userId)
  const { publicKey, credentialId } = storedColumns(key)
  await admin.query(
    `insert into passkeys (id, public_key, user_id, credential_id, counter, device_type, backed_up)
     values ($1, $2, $3, $4, 0, 'singleDevice', false)`,
    [randomUUID(), publicKey, userId, credentialId],
  )
  return key
}

function passkeySignIn(key: SoftPasskey, opts: { userVerified: boolean; cookie?: string }) {
  return signInWithPasskey(key, {
    handler: (r) => instance.handler(r),
    panel: PANEL,
    ip: '10.9.0.1',
    userVerified: opts.userVerified,
    ...(opts.cookie === undefined ? {} : { cookie: opts.cookie }),
  })
}

async function newestSession(userId: string) {
  const { rows } = await admin.query<{
    id: string
    auth_method: string
    reauthenticated_at: Date | null
  }>(
    `select id, auth_method, reauthenticated_at from sessions where user_id = $1
     order by created_at desc, id desc limit 1`,
    [userId],
  )
  return rows[0]
}

test('a passkey sign-in over the same person session replaces it with a confirmed one', async () => {
  const p = await person()
  const key = await softPasskey(p.id)
  const [old] = await sessionIds(p.id)
  const res = await passkeySignIn(key, {
    userVerified: true,
    cookie: p.headers.get('cookie') ?? '',
  })
  expect(res.status).toBe(200)
  const ids = await sessionIds(p.id)
  expect(ids).toHaveLength(1)
  expect(ids).not.toContain(old)
  expect(await newestSession(p.id)).toMatchObject({ auth_method: 'passkey' })
  expect((await newestSession(p.id))?.reauthenticated_at).not.toBeNull()
  expect(await auditOf(p.id, 'auth.reauthenticated')).toEqual([
    { entity_id: at(ids, 0), data: { method: 'passkey' } },
  ])
})

test('a passkey sign-in without the PIN or the screen lock is refused', async () => {
  const p = await person()
  const key = await softPasskey(p.id)
  const before = await sessionIds(p.id)
  const res = await passkeySignIn(key, {
    userVerified: false,
    cookie: p.headers.get('cookie') ?? '',
  })
  expect(res.status).toBe(401)
  expect(await sessionIds(p.id)).toEqual(before)
})

test('without a session, or with someone else, a passkey sign-in is not a reauth', async () => {
  const p = await person()
  const key = await softPasskey(p.id)
  const [first] = await sessionIds(p.id)
  expect((await passkeySignIn(key, { userVerified: true })).status).toBe(200)
  expect(await sessionIds(p.id)).toContain(first)
  expect((await newestSession(p.id))?.reauthenticated_at).toBeNull()

  const other = await person()
  const [theirs] = await sessionIds(other.id)
  const res = await passkeySignIn(key, {
    userVerified: true,
    cookie: other.headers.get('cookie') ?? '',
  })
  expect(res.status).toBe(200)
  expect(await sessionIds(other.id)).toEqual([theirs])
  expect((await newestSession(p.id))?.reauthenticated_at).toBeNull()
  expect(await auditOf(p.id, 'auth.reauthenticated')).toEqual([])
})

test('a tampered cookie or a session past 30 days does not count', async () => {
  const p = await person()
  const key = await softPasskey(p.id)
  const cookie = p.headers.get('cookie') ?? ''
  const tampered = cookie.replace(/.(;|$)/, (m) => (m.startsWith('A') ? 'B' : 'A') + m.slice(1))
  expect((await passkeySignIn(key, { userVerified: true, cookie: tampered })).status).toBe(200)
  expect((await newestSession(p.id))?.reauthenticated_at).toBeNull()

  const q = await person()
  const qKey = await softPasskey(q.id)
  await admin.query(
    "update sessions set created_at = now() - interval '31 days' where user_id = $1",
    [q.id],
  )
  const res = await passkeySignIn(qKey, {
    userVerified: true,
    cookie: q.headers.get('cookie') ?? '',
  })
  expect(res.status).toBe(200)
  expect((await newestSession(q.id))?.reauthenticated_at).toBeNull()
  expect(await auditOf(q.id, 'auth.reauthenticated')).toEqual([])
})

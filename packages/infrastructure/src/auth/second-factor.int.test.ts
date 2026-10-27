import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import {
  createAuthEventSink,
  reauthenticate,
  resolveSession,
  resolveSessionUser,
  secondFactorOverview,
  type Auth,
  type IdentityDeps,
  type JobPayloads,
  type JobQueue,
} from '@app/application'
import type { OrgRole } from '@app/domain'
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
  passkeyRegister,
  passkeySignIn,
  storedColumns,
} from '../testing/soft-passkey.js'
import { createAuthAdapter } from './auth-adapter.js'
import { createBetterAuth, type BetterAuthInstance } from './better-auth.js'
import { cookieHeader, secretOf, totpCode } from './contract/helpers.js'

const PANEL = 'https://app.feedway.test'
// low entropy on purpose: a made-up value, not a secret for the leak scanner
const PASSWORD = 'cavallo-batteria-graffetta-lago'
const LAST_FACTOR =
  "La 2FA è obbligatoria per il tuo ruolo: aggiungi prima un'altra passkey o l'app di autenticazione"
const USE_EXISTING = "Hai già una passkey o l'app di autenticazione: esci e accedi con quella"

let tdb: TestDatabase
let admin: pg.Client
let instance: BetterAuthInstance
let auth: Auth
let deps: Pick<IdentityDeps, 'uow' | 'auth' | 'config' | 'clock' | 'rateLimiter'>
const logger = createLogger({ service: 'web', level: 'error' })
const queued: JobPayloads['identity.security_email'][] = []

const queue: JobQueue = {
  send(name, data) {
    if (name === 'identity.security_email')
      queued.push(data as JobPayloads['identity.security_email'])
    return Promise.resolve(null)
  },
  work: () => Promise.reject(new Error('not used')),
  ping: () => Promise.resolve(),
  stop: () => Promise.resolve(),
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  const { db } = createDb(tdb.runtimeUrl, { max: 5, applicationName: 'second-factor-test' })
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  const uow = createUnitOfWork({ db, ids: uuidV7Generator, logger })
  const secret = randomBytes(32).toString('hex')
  const rateLimiter = createPgRateLimiter({ db, clock: systemClock })
  const config = {
    require2fa: 'admins' as const,
    bootstrapOwnerEmail: null,
    bootstrapOrganizationName: '',
    panelUrl: PANEL,
  }
  instance = createBetterAuth({
    db,
    signedTokens: createSignedTokens(randomBytes(32)),
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
    queue,
    events: createAuthEventSink({
      uow,
      queue,
      tokens: createSignedTokens(randomBytes(32)),
      clock: systemClock,
      logger,
    }),
    resolveSessionUser: (session) => resolveSessionUser({ uow, config }, session),
  })
  auth = createAuthAdapter(instance, { db, clock: systemClock })
  deps = { uow, auth, clock: systemClock, rateLimiter, config }
})
afterAll(async () => {
  await admin.end()
  await tdb.stop()
})
beforeEach(() => {
  queued.length = 0
})

let ipSeq = 0
const nextIp = () => `10.30.${String(Math.floor(++ipSeq / 250) % 250)}.${String(ipSeq % 250)}`

function call(method: 'GET' | 'POST', path: string, cookie: string, body?: unknown) {
  return instance.handler(
    new Request(`${PANEL}/api/auth${path}`, {
      method,
      headers: {
        origin: PANEL,
        'x-app-client-ip': nextIp(),
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie === '' ? {} : { cookie }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
}
const post = (path: string, body: unknown, cookie = '') => call('POST', path, cookie, body)

/** A person with a password and the given memberships. */
async function person(roles: OrgRole[] = []) {
  const id = randomUUID()
  const email = `fattore-${id.slice(0, 8)}@esempio.it`
  await auth.createUser({ id, email, name: 'Anna Rossi', password: PASSWORD })
  for (const role of roles) {
    const org = await seed(tdb.runtimeUrl, (s) => s.organization())
    await seed(tdb.runtimeUrl, (s) => s.member(org, id, role))
  }
  return { id, email }
}

/** The password step: a session cookie, or the 2FA cookie when TOTP is on. */
async function signIn(email: string): Promise<string> {
  const res = await post('/sign-in/email', { email, password: PASSWORD })
  expect(res.status).toBe(200)
  return cookieHeader(res.headers.getSetCookie())
}

/** The cookie the browser holds after an answer: a new session replaces the old one. */
function cookieAfter(res: Response, before: string): string {
  // the last one wins in the browser: an answer may first clear the cookie, then set it again
  const session = res.headers
    .getSetCookie()
    .filter((c) => c.startsWith('__Host-session='))
    .at(-1)
  return session === undefined ? before : cookieHeader([session])
}

async function enableTotp(cookie: string) {
  const res = await post('/two-factor/enable', { password: PASSWORD }, cookie)
  if (res.status !== 200) return { res, totpURI: '', backupCodes: [] as string[] }
  const body = (await res.json()) as { totpURI: string; backupCodes: string[] }
  return { res, ...body }
}

/** TOTP enrolled from the session `cookie`; returns the cookie of the session in use after. */
async function enrolTotp(cookie: string) {
  const { totpURI, backupCodes } = await enableTotp(cookie)
  const res = await post('/two-factor/verify-totp', { code: totpCode(secretOf(totpURI)) }, cookie)
  expect(res.status).toBe(200)
  return { cookie: cookieAfter(res, cookie), secret: secretOf(totpURI), backupCodes }
}

const headersOf = (cookie: string) => new Headers({ cookie })

async function resolved(cookie: string) {
  const r = await resolveSession(deps, { headers: headersOf(cookie) })
  if (!r) throw new Error('no session')
  return r
}

/** A reauth with the password, as the panel does it before a sensitive change. */
async function reauth(cookie: string) {
  await reauthenticate(deps, (await resolved(cookie)).session, { password: PASSWORD }, { ip: null })
}

async function addPasskeyRow(userId: string): Promise<string> {
  const id = randomUUID()
  const { publicKey, credentialId } = storedColumns(newSoftPasskey(userId))
  await admin.query(
    `insert into passkeys (id, name, public_key, user_id, credential_id, counter, device_type,
       backed_up, created_at)
     values ($1, 'Portatile', $2, $3, $4, 0, 'multiDevice', true, now())`,
    [id, publicKey, userId, credentialId],
  )
  return id
}

async function totpRow(userId: string) {
  const { rows } = await admin.query<{ verified: boolean }>(
    'select verified from two_factors where user_id = $1',
    [userId],
  )
  return rows[0] ?? null
}

async function passkeyIds(userId: string): Promise<string[]> {
  const { rows } = await admin.query<{ id: string }>(
    'select id from passkeys where user_id = $1 order by id',
    [userId],
  )
  return rows.map((r) => r.id)
}

async function auditActions(userId: string): Promise<string[]> {
  const { rows } = await admin.query<{ action: string }>(
    'select action from audit_log where actor_id = $1 order by created_at, id',
    [userId],
  )
  return rows.map((r) => r.action)
}

const emailsOf = (userId: string) => queued.filter((j) => j.userId === userId).map((j) => j.kind)

async function sessionRows(userId: string) {
  const { rows } = await admin.query<{ id: string; auth_method: string; created_at: Date }>(
    'select id, auth_method, created_at from sessions where user_id = $1 order by created_at, id',
    [userId],
  )
  return rows
}

test('enrolment returns 10 backup codes and the session in use becomes active (V9)', async () => {
  const p = await person(['admin'])
  const cookie = await signIn(p.email)
  const [before] = await sessionRows(p.id)
  expect((await resolved(cookie)).state).toBe('second_factor_required')

  const { totpURI, backupCodes } = await enableTotp(cookie)
  expect(backupCodes).toHaveLength(10)
  const res = await post('/two-factor/verify-totp', { code: totpCode(secretOf(totpURI)) }, cookie)
  expect(res.status).toBe(200)
  const inUse = cookieAfter(res, cookie)

  const r = await resolved(inUse)
  expect(r.state).toBe('active')
  expect(r.user.secondFactor).toEqual({ required: true, totpEnabled: true, passkeys: 0 })
  // verify-totp replaces the session: same 30-day start, method of the second factor
  const rows = await sessionRows(p.id)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.id).not.toBe(before?.id)
  expect(rows[0]?.auth_method).toBe('password_totp')
  expect(rows[0]?.created_at).toEqual(before?.created_at)
  // the password sign-in is the only login: the enrolment is not one
  expect(await auditActions(p.id)).toEqual(['auth.login', 'auth.totp_enabled'])
  expect(emailsOf(p.id)).toEqual(['totp_enabled'])

  // a code checked again over the new session changes nothing and records nothing
  const again = await post('/two-factor/verify-totp', { code: totpCode(secretOf(totpURI)) }, inUse)
  expect(again.status).toBe(200)
  expect(await auditActions(p.id)).toEqual(['auth.login', 'auth.totp_enabled'])
})

test('a wrong code does not enrol and records nothing', async () => {
  const p = await person(['admin'])
  const cookie = await signIn(p.email)
  const { totpURI } = await enableTotp(cookie)
  const wrong = String((Number(totpCode(secretOf(totpURI))) + 1) % 1_000_000).padStart(6, '0')
  expect((await post('/two-factor/verify-totp', { code: wrong }, cookie)).status).toBe(401)
  expect(await totpRow(p.id)).toEqual({ verified: false })
  expect(await auditActions(p.id)).not.toContain('auth.totp_enabled')
  expect(emailsOf(p.id)).toEqual([])
})

test('backup code signs in once', async () => {
  const p = await person()
  const { backupCodes } = await enrolTotp(await signIn(p.email))
  const [code] = backupCodes
  const first = await post('/two-factor/verify-backup-code', { code }, await signIn(p.email))
  expect(first.status).toBe(200)
  expect((await resolved(cookieAfter(first, ''))).session.authMethod).toBe('password_backup_code')
  const again = await post('/two-factor/verify-backup-code', { code }, await signIn(p.email))
  expect(again.status).toBe(401)
})

test('trust device is refused on a real pending sign-in, with the right code', async () => {
  const p = await person()
  const { secret } = await enrolTotp(await signIn(p.email))
  const pending = await signIn(p.email)
  const before = await sessionRows(p.id)
  const res = await post(
    '/two-factor/verify-totp',
    { code: totpCode(secret), trustDevice: true },
    pending,
  )
  expect(res.status).toBe(400)
  expect(res.headers.getSetCookie().join()).not.toMatch(/trust/i)
  expect(await sessionRows(p.id)).toEqual(before)
})

test('the same totp code is accepted twice within its period (pinned, ADR 012)', async () => {
  const p = await person()
  const { secret } = await enrolTotp(await signIn(p.email))
  const code = totpCode(secret)
  const first = await post('/two-factor/verify-totp', { code }, await signIn(p.email))
  const second = await post('/two-factor/verify-totp', { code }, await signIn(p.email))
  expect(first.status).toBe(200)
  // The library keeps no record of used codes: a code seen over someone's shoulder works
  // again for the rest of its window. Accepted and written down in ADR 012.
  expect(second.status).toBe(200)
})

test('disable requires a recent reauth', async () => {
  const p = await person()
  const { cookie } = await enrolTotp(await signIn(p.email))
  const never = await post('/two-factor/disable', { password: PASSWORD }, cookie)
  expect(never.status).toBe(403)
  expect(await never.json()).toMatchObject({ code: 'REAUTH_REQUIRED' })

  await reauth(cookie)
  await admin.query(
    "update sessions set reauthenticated_at = now() - interval '11 minutes' where user_id = $1",
    [p.id],
  )
  expect((await post('/two-factor/disable', { password: PASSWORD }, cookie)).status).toBe(403)
  expect(await totpRow(p.id)).toEqual({ verified: true })
  expect(await auditActions(p.id)).not.toContain('auth.totp_disabled')

  await reauth(cookie)
  expect((await post('/two-factor/disable', { password: PASSWORD }, cookie)).status).toBe(200)
  expect(await totpRow(p.id)).toBeNull()
  expect(await auditActions(p.id)).toContain('auth.totp_disabled')
  expect(emailsOf(p.id)).toEqual(['totp_enabled', 'totp_disabled'])
})

test('cannot remove the last required second factor', async () => {
  const totpOnly = await person(['owner'])
  const a = await enrolTotp(await signIn(totpOnly.email))
  await reauth(a.cookie)
  const refused = await post('/two-factor/disable', { password: PASSWORD }, a.cookie)
  expect(refused.status).toBe(403)
  expect(await refused.json()).toMatchObject({
    code: 'SECOND_FACTOR_REQUIRED',
    message: LAST_FACTOR,
  })
  expect(await totpRow(totpOnly.id)).toEqual({ verified: true })

  const passkeyOnly = await person(['owner'])
  const onlyPasskey = await addPasskeyRow(passkeyOnly.id)
  const b = await signIn(passkeyOnly.email)
  await admin.query("update sessions set auth_method = 'passkey' where user_id = $1", [
    passkeyOnly.id,
  ])
  await reauth(b)
  const kept = await post('/passkey/delete-passkey', { id: onlyPasskey }, b)
  expect(kept.status).toBe(403)
  expect(await kept.json()).toMatchObject({ code: 'SECOND_FACTOR_REQUIRED', message: LAST_FACTOR })
  expect(await passkeyIds(passkeyOnly.id)).toEqual([onlyPasskey])

  const both = await person(['owner'])
  const c = await enrolTotp(await signIn(both.email))
  await addPasskeyRow(both.id)
  await reauth(c.cookie)
  expect((await post('/two-factor/disable', { password: PASSWORD }, c.cookie)).status).toBe(200)
  expect(await totpRow(both.id)).toBeNull()
})

test('a member may remove their only factor', async () => {
  const p = await person(['member'])
  const passkey = await addPasskeyRow(p.id)
  const cookie = await signIn(p.email)
  await reauth(cookie)
  expect((await post('/passkey/delete-passkey', { id: passkey }, cookie)).status).toBe(200)
  expect(await passkeyIds(p.id)).toEqual([])
})

test("someone else's passkey cannot be deleted", async () => {
  const p = await person()
  const other = await person()
  const theirs = await addPasskeyRow(other.id)
  const cookie = await signIn(p.email)
  await reauth(cookie)
  for (const id of [theirs, 'non-un-id']) {
    const res = await post('/passkey/delete-passkey', { id }, cookie)
    expect(res.status).toBe(404)
  }
  expect(await passkeyIds(other.id)).toEqual([theirs])
  expect(await auditActions(p.id)).not.toContain('auth.passkey_removed')
  expect(emailsOf(p.id)).toEqual([])
})

test('passkey removal is audited and mailed', async () => {
  const p = await person()
  const passkey = await addPasskeyRow(p.id)
  const cookie = await signIn(p.email)
  expect((await post('/passkey/delete-passkey', { id: passkey }, cookie)).status).toBe(403)
  expect(await passkeyIds(p.id)).toEqual([passkey])
  await reauth(cookie)
  expect((await post('/passkey/delete-passkey', { id: passkey }, cookie)).status).toBe(200)
  expect(await passkeyIds(p.id)).toEqual([])
  expect(await auditActions(p.id)).toContain('auth.passkey_removed')
  expect(emailsOf(p.id)).toEqual(['passkey_removed'])
})

test('new backup codes need a recent reauth, and are audited and mailed', async () => {
  const p = await person()
  const { cookie } = await enrolTotp(await signIn(p.email))
  const refused = await post('/two-factor/generate-backup-codes', { password: PASSWORD }, cookie)
  expect(refused.status).toBe(403)
  expect(await refused.json()).toMatchObject({ code: 'REAUTH_REQUIRED' })
  expect(await auditActions(p.id)).not.toContain('auth.backup_codes_regenerated')

  await reauth(cookie)
  const res = await post('/two-factor/generate-backup-codes', { password: PASSWORD }, cookie)
  expect(res.status).toBe(200)
  expect(((await res.json()) as { backupCodes: string[] }).backupCodes).toHaveLength(10)
  expect(await auditActions(p.id)).toContain('auth.backup_codes_regenerated')
  expect(emailsOf(p.id)).toEqual(['totp_enabled', 'backup_codes_regenerated'])
})

test('a stolen password cannot enrol a new factor for a user who already has one', async () => {
  const p = await person(['admin'])
  await addPasskeyRow(p.id)
  const cookie = await signIn(p.email) // password only: second_factor_required
  const totp = await enableTotp(cookie)
  expect(totp.res.status).toBe(403)
  expect(await totp.res.json()).toEqual({
    code: 'SECOND_FACTOR_REQUIRED',
    reason: 'use_existing_factor',
    message: USE_EXISTING,
  })
  const options = await call('GET', '/passkey/generate-register-options', cookie)
  expect(options.status).toBe(403)
  expect(await options.json()).toMatchObject({ reason: 'use_existing_factor' })
  const registration = await post('/passkey/verify-registration', { response: {} }, cookie)
  expect(registration.status).toBe(403)
  expect(await totpRow(p.id)).toBeNull()
  expect(await passkeyIds(p.id)).toHaveLength(1)
})

test('a session that still owes the second factor changes no factor, even after a reauth', async () => {
  const p = await person(['admin'])
  const older = await signIn(p.email) // another device, before the enrolment
  await enrolTotp(await signIn(p.email))
  expect((await resolved(older)).state).toBe('second_factor_required')
  await reauth(older)
  for (const path of ['/two-factor/generate-backup-codes', '/two-factor/get-totp-uri']) {
    const res = await post(path, { password: PASSWORD }, older)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      code: 'SECOND_FACTOR_REQUIRED',
      reason: 'use_existing_factor',
    })
  }
  expect(await auditActions(p.id)).not.toContain('auth.backup_codes_regenerated')
})

test('a session past 30 days changes nothing, even right after a reauth', async () => {
  const p = await person()
  const { cookie } = await enrolTotp(await signIn(p.email))
  await reauth(cookie)
  await admin.query(
    "update sessions set created_at = now() - interval '31 days' where user_id = $1",
    [p.id],
  )
  const res = await post('/two-factor/disable', { password: PASSWORD }, cookie)
  expect(res.status).toBe(401)
  expect(await totpRow(p.id)).toEqual({ verified: true })
  expect(await auditActions(p.id)).not.toContain('auth.totp_disabled')
})

test('a disabled person changes nothing with a session still open', async () => {
  const p = await person()
  const passkey = await addPasskeyRow(p.id)
  const cookie = await signIn(p.email)
  await reauth(cookie)
  await admin.query("update users set status = 'disabled', disabled_at = now() where id = $1", [
    p.id,
  ])
  expect((await post('/passkey/delete-passkey', { id: passkey }, cookie)).status).toBe(401)
  expect(await passkeyIds(p.id)).toEqual([passkey])
})

test('the first passkey of a new admin is registered, audited and mailed', async () => {
  const p = await person(['admin'])
  const cookie = await signIn(p.email) // first setup: second_factor_required, no factor yet
  const key = newSoftPasskey(p.id)
  const res = await passkeyRegister(key, {
    handler: (r) => instance.handler(r),
    panel: PANEL,
    ip: nextIp(),
    cookie,
    name: 'Telefono',
  })
  expect(res.status).toBe(200)
  expect(await passkeyIds(p.id)).toHaveLength(1)
  expect(await auditActions(p.id)).toContain('auth.passkey_added')
  expect(emailsOf(p.id)).toEqual(['passkey_added'])
  // and it signs in, as the second factor the session needed
  const signedIn = await passkeySignIn(key, {
    handler: (r) => instance.handler(r),
    panel: PANEL,
    ip: nextIp(),
    userVerified: true,
  })
  expect(signedIn.status).toBe(200)
  expect((await resolved(cookieAfter(signedIn, ''))).state).toBe('active')
})

test('the security page lists the factors', async () => {
  const p = await person(['admin'])
  const { cookie } = await enrolTotp(await signIn(p.email))
  const passkey = await addPasskeyRow(p.id)
  const overview = await secondFactorOverview(deps, (await resolved(cookie)).user)
  expect(overview).toEqual({
    required: true,
    totpEnabled: true,
    passkeys: [
      {
        id: passkey,
        name: 'Portatile',
        createdAt: expect.any(Date) as Date,
        deviceType: 'multiDevice',
        backedUp: true,
      },
    ],
  })
  const member = await person(['member'])
  expect(
    await secondFactorOverview(deps, (await resolved(await signIn(member.email))).user),
  ).toEqual({ required: false, totpEnabled: false, passkeys: [] })
})

test('signing in again over a leftover password session completes with the code', async () => {
  const p = await person(['admin'])
  // two browsers signed in before TOTP: password only, still open
  const leftovers = [await signIn(p.email), await signIn(p.email)]
  const { secret, backupCodes } = await enrolTotp(await signIn(p.email))
  for (const [i, proof] of [
    { path: '/two-factor/verify-totp', body: { code: totpCode(secret) } },
    { path: '/two-factor/verify-backup-code', body: { code: backupCodes[0] } },
  ].entries()) {
    // the 2FA cookie of a new sign-in next to the old session cookie
    const browser = `${leftovers[i] ?? ''}; ${await signIn(p.email)}`
    const res = await post(proof.path, proof.body, browser)
    expect(res.status).toBe(200)
    expect((await resolved(cookieAfter(res, browser))).state).toBe('active')
  }
  // the leftovers are gone: only the enrolment session and the two new sign-ins remain
  expect((await sessionRows(p.id)).map((r) => r.auth_method)).toEqual([
    'password_totp',
    'password_totp',
    'password_backup_code',
  ])
})

test('the code step keeps a valid session of the same person, drops any other', async () => {
  const p = await person(['admin'])
  const { cookie: enrolled, secret } = await enrolTotp(await signIn(p.email))
  const [kept] = await sessionRows(p.id)

  // the same person, already past the second factor: kept, the code is checked against it
  const same = `${enrolled}; ${await signIn(p.email)}`
  expect((await post('/two-factor/verify-totp', { code: totpCode(secret) }, same)).status).toBe(200)
  expect((await sessionRows(p.id)).map((r) => r.id)).toContain(kept?.id)

  // past our 30 days: dropped, and the code opens a new session
  await admin.query("update sessions set created_at = now() - interval '31 days' where id = $1", [
    kept?.id,
  ])
  const stale = `${enrolled}; ${await signIn(p.email)}`
  const res = await post('/two-factor/verify-totp', { code: totpCode(secret) }, stale)
  expect(res.status).toBe(200)
  expect((await resolved(cookieAfter(res, stale))).state).toBe('active')
  expect((await sessionRows(p.id)).map((r) => r.id)).not.toContain(kept?.id)

  // someone else's session in the same browser: dropped, the browser ends up as this person
  const other = await person()
  const theirs = await signIn(other.email)
  const shared = `${theirs}; ${await signIn(p.email)}`
  const mine = await post('/two-factor/verify-totp', { code: totpCode(secret) }, shared)
  expect(mine.status).toBe(200)
  expect((await resolved(cookieAfter(mine, shared))).user.id).toBe(p.id)
  expect(await sessionRows(other.id)).toEqual([])
})

test('a password session cannot finish an abandoned enrolment of someone with a passkey', async () => {
  const p = await person(['admin'])
  await addPasskeyRow(p.id)
  // the owner, signed in with the passkey, starts the authenticator app and leaves it there
  const owner = await signIn(p.email)
  await admin.query("update sessions set auth_method = 'passkey' where user_id = $1", [p.id])
  const { totpURI, backupCodes } = await enableTotp(owner)
  expect(await totpRow(p.id)).toEqual({ verified: false })

  // someone with the password only: no 2FA step, a session that owes the second factor
  const stolen = await signIn(p.email)
  expect((await resolved(stolen)).state).toBe('second_factor_required')
  for (const [path, code] of [
    ['/two-factor/verify-totp', totpCode(secretOf(totpURI))],
    ['/two-factor/verify-backup-code', backupCodes[0]],
  ] as const) {
    const res = await post(path, { code }, stolen)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ reason: 'use_existing_factor' })
  }
  expect(await totpRow(p.id)).toEqual({ verified: false })
  expect((await resolved(stolen)).state).toBe('second_factor_required')
  expect(await auditActions(p.id)).not.toContain('auth.totp_enabled')
})

test('an expired or disabled session cannot finish an enrolment', async () => {
  const old = await person()
  const oldCookie = await signIn(old.email)
  const a = await enableTotp(oldCookie)
  await admin.query(
    "update sessions set created_at = now() - interval '31 days' where user_id = $1",
    [old.id],
  )
  const late = await post(
    '/two-factor/verify-totp',
    { code: totpCode(secretOf(a.totpURI)) },
    oldCookie,
  )
  expect(late.status).toBe(401)
  expect(await totpRow(old.id)).toEqual({ verified: false })

  const gone = await person()
  const goneCookie = await signIn(gone.email)
  const b = await enableTotp(goneCookie)
  await admin.query("update users set status = 'disabled', disabled_at = now() where id = $1", [
    gone.id,
  ])
  const res = await post(
    '/two-factor/verify-totp',
    { code: totpCode(secretOf(b.totpURI)) },
    goneCookie,
  )
  expect(res.status).toBe(401)
  expect(await totpRow(gone.id)).toEqual({ verified: false })
  const { rows } = await admin.query<{ two_factor_enabled: boolean }>(
    'select two_factor_enabled from users where id = $1',
    [gone.id],
  )
  expect(rows[0]?.two_factor_enabled).toBe(false)
})

test('a wrong code while signing in is recorded as a failed second factor', async () => {
  const p = await person()
  const { secret } = await enrolTotp(await signIn(p.email))
  const wrong = String((Number(totpCode(secret)) + 1) % 1_000_000).padStart(6, '0')
  const res = await post('/two-factor/verify-totp', { code: wrong }, await signIn(p.email))
  expect(res.status).toBe(401)
  expect(await auditActions(p.id)).toContain('auth.second_factor_failed')
})

test('with no factor yet, only the first setup is open', async () => {
  const p = await person(['admin'])
  const cookie = await signIn(p.email)
  const list = await call('GET', '/passkey/list-user-passkeys', cookie)
  expect(list.status).toBe(403)
  expect(await list.json()).toEqual({
    code: 'SECOND_FACTOR_REQUIRED',
    message: "Configura prima una passkey o l'app di autenticazione",
  })
})

test('a session that owes the second factor reaches no other account path', async () => {
  const p = await person(['admin'])
  const passkey = await addPasskeyRow(p.id)
  const cookie = await signIn(p.email)
  const attempts = [
    call('GET', '/passkey/list-user-passkeys', cookie),
    post('/passkey/update-passkey', { id: passkey, name: 'Mio' }, cookie),
    post(
      '/change-password',
      { currentPassword: PASSWORD, newPassword: 'tramonto-ombrello-giraffa-canale' },
      cookie,
    ),
    post('/change-email', { newEmail: `nuova-${p.id.slice(0, 8)}@esempio.it` }, cookie),
  ]
  for (const res of await Promise.all(attempts)) {
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ reason: 'use_existing_factor' })
  }
})

test('cancelling an unfinished enrolment records no disabled TOTP', async () => {
  const p = await person()
  const cookie = await signIn(p.email)
  await enableTotp(cookie)
  await reauth(cookie)
  expect((await post('/two-factor/disable', { password: PASSWORD }, cookie)).status).toBe(200)
  expect(await totpRow(p.id)).toBeNull()
  expect(await auditActions(p.id)).not.toContain('auth.totp_disabled')
  expect(emailsOf(p.id)).toEqual([])
})

test('registering a passkey cannot open a second session', async () => {
  const p = await person()
  const cookie = await signIn(p.email)
  const res = await post(
    '/passkey/verify-registration',
    { response: {}, createSession: true },
    cookie,
  )
  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ message: 'Opzione non disponibile' })
  expect(await sessionRows(p.id)).toHaveLength(1)
})

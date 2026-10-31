import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import {
  confirmEmailChange,
  createAuthEventSink,
  listMembers,
  lockAccountFromSecurityEmail,
  reauthenticate,
  resolveOrgActor,
  resolveSession,
  resolveSessionUser,
  sendEmailChangeEmail,
  sendSecurityEmail,
  startEmailChange,
  updateProfile,
  type Auth,
  type JobPayloads,
  type JobQueue,
  type QueueName,
  type SessionUser,
} from '@app/application'
import { createDb } from '../db/client.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createPasswordHasher } from '../crypto/password-hasher.js'
import { createSignedTokens } from '../crypto/signed-tokens.js'
import { createTokenService } from '../crypto/tokens.js'
import { createPgRateLimiter } from '../db/rate-limiter.js'
import { createTranslate } from '../i18n/translate.js'
import { createLogger } from '../logging/logger.js'
import { createMemoryMailer } from '../mail/memory-mailer.js'
import { systemClock } from '../system/clock.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { fixedClock, seed, startTestDatabase, type TestDatabase } from '../testing/index.js'
import { createAuthAdapter } from './auth-adapter.js'
import { createBetterAuth, type BetterAuthInstance } from './better-auth.js'
import { cookieHeader } from './contract/helpers.js'

const PANEL = 'https://app.feedway.test'
// low entropy on purpose: a made-up value, not a secret for the leak scanner
const PASSWORD = 'cavallo-batteria-graffetta-lago'

let tdb: TestDatabase
let admin: pg.Client
let instance: BetterAuthInstance
let auth: Auth
let uow: ReturnType<typeof createUnitOfWork>
let rateLimiter: ReturnType<typeof createPgRateLimiter>
const logger = createLogger({ service: 'web', level: 'error' })
const signedTokens = createSignedTokens(randomBytes(32))
const tokens = createTokenService()
const translate = createTranslate(
  JSON.parse(
    readFileSync(new URL('../../../../apps/web/i18n/locales/it.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>,
)
const mailer = createMemoryMailer()
let mailConfigured = true
const config = {
  require2fa: 'admins' as const,
  bootstrapOwnerEmail: null,
  bootstrapOrganizationName: '',
  panelUrl: PANEL,
}

type Queued = { [N in QueueName]: { name: N; data: JobPayloads[N] } }[QueueName]
const queued: Queued[] = []
const queue: JobQueue = {
  send(name, data) {
    queued.push({ name, data } as Queued)
    return Promise.resolve(null)
  },
  work: () => Promise.reject(new Error('not used')),
  ping: () => Promise.resolve(),
  stop: () => Promise.resolve(),
}

const mailDeps = () => ({
  uow,
  mailer,
  translate,
  logger,
  clock: systemClock,
  panelUrl: new URL(PANEL),
  productName: 'Feedway',
  defaultTimezone: 'Europe/Rome',
})

/** Runs the queued email jobs as the worker would, in order. */
async function runQueuedJobs() {
  for (const job of queued.splice(0)) {
    if (job.name === 'identity.email_change') await sendEmailChangeEmail(mailDeps(), job.data)
    if (job.name === 'identity.security_email')
      await sendSecurityEmail({ ...mailDeps(), tokens: signedTokens }, job.data)
  }
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  const { db } = createDb(tdb.runtimeUrl, { max: 5, applicationName: 'email-change-test' })
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  uow = createUnitOfWork({ db, ids: uuidV7Generator, logger })
  const secret = randomBytes(32).toString('hex')
  rateLimiter = createPgRateLimiter({ db, clock: systemClock })
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
    queue,
    events: createAuthEventSink({ uow, queue, tokens: signedTokens, clock: systemClock, logger }),
    resolveSessionUser: (session) => resolveSessionUser({ uow, config }, session),
    emailChange: {
      mailer: { isConfigured: () => Promise.resolve(mailConfigured) },
      start: (input) =>
        startEmailChange(
          { uow, queue, tokens, clock: systemClock, panelUrl: new URL(PANEL) },
          input,
        ),
    },
  })
  auth = createAuthAdapter(instance, { db, clock: systemClock })
})
afterAll(async () => {
  await admin.end()
  await tdb.stop()
})
beforeEach(() => {
  queued.length = 0
  mailConfigured = true
})

let ipSeq = 0
const nextIp = () => `10.40.${String(Math.floor(++ipSeq / 250) % 250)}.${String(ipSeq % 250)}`

function post(path: string, body: unknown, cookie: string) {
  return instance.handler(
    new Request(`${PANEL}/api/auth${path}`, {
      method: 'POST',
      headers: {
        origin: PANEL,
        'x-app-client-ip': nextIp(),
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0',
        'content-type': 'application/json',
        ...(cookie === '' ? {} : { cookie }),
      },
      body: JSON.stringify(body),
    }),
  )
}

async function person(name = 'Matteo Greco') {
  const id = randomUUID()
  const email = `cambio-${id.slice(0, 8)}@esempio.it`
  await auth.createUser({ id, email, name, password: PASSWORD })
  return { id, email }
}

async function signIn(email: string): Promise<string> {
  const res = await post('/sign-in/email', { email, password: PASSWORD }, '')
  expect(res.status).toBe(200)
  return cookieHeader(res.headers.getSetCookie())
}

async function resolved(cookie: string) {
  const r = await resolveSession({ uow, auth, config }, { headers: new Headers({ cookie }) })
  if (!r) throw new Error('no session')
  return r
}

/** A session confirmed in the last minutes, as the panel leaves it before a sensitive change. */
async function freshSignIn(email: string): Promise<string> {
  const cookie = await signIn(email)
  await reauthenticate(
    { uow, auth, clock: systemClock, rateLimiter },
    (await resolved(cookie)).session,
    { password: PASSWORD },
    { ip: null },
  )
  return cookie
}

const changeEmail = (cookie: string, newEmail: string, extra: Record<string, unknown> = {}) =>
  post('/change-email', { newEmail, ...extra }, cookie)

const rawUser = async (id: string) =>
  (
    await admin.query<{ email: string; status: string; email_verified: boolean }>(
      'select email, status, email_verified from users where id = $1',
      [id],
    )
  ).rows[0]

const mailsTo = (to: string) => mailer.sent.filter((m) => m.to === to)
const mailTo = (to: string) => {
  const mail = mailsTo(to).at(-1)
  if (!mail) throw new Error(`no email to ${to}`)
  return mail
}
const confirmLinkIn = (text: string) => {
  const match = /\/conferma-email\?t=([A-Za-z0-9._-]+)/.exec(text)
  if (!match?.[1]) throw new Error('no confirmation link in the email')
  return match[1]
}
const lockTokenIn = (text: string) => {
  const match = /non-sono-stato-io\?t=([A-Za-z0-9._-]+)/.exec(text)
  if (!match?.[1]) throw new Error('no lock link in the email')
  return match[1]
}
const confirm = (token: string, clock = systemClock) =>
  confirmEmailChange(
    { uow, queue, tokens, clock },
    { token, ip: '93.41.12.200', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari' },
  )
const auditActions = async (userId: string) =>
  (
    await admin.query<{ action: string; data: unknown }>(
      'select action, data from audit_log where actor_id = $1 order by created_at, id',
      [userId],
    )
  ).rows

// ---------------------------------------------------------------- profile

async function sessionUser(cookie: string): Promise<SessionUser> {
  return (await resolved(cookie)).user
}

test('nickname replaces the name where people are shown', async () => {
  const org = await seed(tdb.runtimeUrl, (s) => s.organization())
  const owner = await person('Olga Proprietaria')
  const member = await person()
  await seed(tdb.runtimeUrl, (s) => s.member(org, owner.id, 'owner'))
  await seed(tdb.runtimeUrl, (s) => s.member(org, member.id, 'member'))
  const me = await sessionUser(await signIn(member.email))
  const updated = await updateProfile({ uow }, me, { nickname: '  Teo ' }, { ip: null })
  expect(updated).toMatchObject({ nickname: 'Teo', displayName: 'Teo', name: 'Matteo Greco' })
  const actor = await resolveOrgActor({ uow }, { userId: owner.id, organizationSlug: org })
  expect((await listMembers({ uow }, actor)).find((m) => m.id === member.id)).toMatchObject({
    displayName: 'Teo',
    name: 'Matteo Greco',
  })
  // an empty nickname removes it
  expect(await updateProfile({ uow }, updated, { nickname: '' }, { ip: null })).toMatchObject({
    nickname: null,
    displayName: 'Matteo Greco',
  })
})

test('nickname longer than 30 and a name that is empty or too long are refused', async () => {
  const p = await person()
  const me = await sessionUser(await signIn(p.email))
  await expect(
    updateProfile({ uow }, me, { nickname: 'a'.repeat(31) }, { ip: null }),
  ).rejects.toMatchObject({ code: 'VALIDATION', details: { field: 'nickname' } })
  for (const name of ['   ', 'a'.repeat(101)])
    await expect(updateProfile({ uow }, me, { name }, { ip: null })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { field: 'name' },
    })
})

test('invalid timezone is refused, a valid one and the theme are saved', async () => {
  const p = await person()
  const me = await sessionUser(await signIn(p.email))
  await expect(
    updateProfile({ uow }, me, { timezone: 'Europe/Roma' }, { ip: null }),
  ).rejects.toMatchObject({ code: 'VALIDATION', details: { field: 'timezone' } })
  await updateProfile({ uow }, me, { timezone: 'America/New_York', theme: 'dark' }, { ip: null })
  const { rows } = await admin.query('select timezone, theme from users where id = $1', [p.id])
  expect(rows[0]).toEqual({ timezone: 'America/New_York', theme: 'dark' })
})

test('profile update audit holds field names only, and nothing when nothing changed', async () => {
  const p = await person()
  const me = await sessionUser(await signIn(p.email))
  await updateProfile({ uow }, me, { name: 'Nome Nuovo', theme: me.theme }, { ip: null })
  const entries = (await auditActions(p.id)).filter((e) => e.action === 'user.profile_updated')
  expect(entries).toEqual([{ action: 'user.profile_updated', data: { fields: ['name'] } }])
  expect(JSON.stringify(entries)).not.toContain('Nome Nuovo')
  await updateProfile({ uow }, me, { theme: me.theme }, { ip: null })
  expect(
    (await auditActions(p.id)).filter((e) => e.action === 'user.profile_updated'),
  ).toHaveLength(1)
})

// ---------------------------------------------------------------- email change

test('email change needs a recent reauth and email that can leave', async () => {
  const p = await person()
  const stale = await signIn(p.email)
  const refused = await changeEmail(stale, 'nuovo-1@esempio.it')
  expect(refused.status).toBe(403)
  expect(await refused.json()).toMatchObject({ code: 'REAUTH_REQUIRED' })

  const fresh = await freshSignIn(p.email)
  mailConfigured = false
  const off = await changeEmail(fresh, 'nuovo-1@esempio.it')
  expect(off.status).toBe(409)
  expect(await off.json()).toMatchObject({ code: 'MAIL_NOT_CONFIGURED' })
  expect(queued).toEqual([])
  expect((await rawUser(p.id))?.email).toBe(p.email)
})

test('the old address is warned as soon as the change is asked, and the email changes only after the new one confirms', async () => {
  const p = await person()
  const newEmail = `nuovo-${p.id.slice(0, 8)}@esempio.it`
  const cookie = await freshSignIn(p.email)
  const other = await signIn(p.email)
  const res = await changeEmail(cookie, newEmail.toUpperCase())
  expect(res.status).toBe(200)
  await runQueuedJobs()

  expect((await rawUser(p.id))?.email).toBe(p.email)
  expect(mailTo(p.email).subject).toMatch(/cambiare l'email/i) // E5b, before any confirmation
  expect(mailTo(p.email).text).toContain(newEmail)
  expect(mailTo(newEmail).subject).toBe('Conferma il nuovo indirizzo del tuo account Feedway')
  expect(mailTo(newEmail).text).toContain(`al posto di ${p.email}`)
  const warnings = mailsTo(p.email).length

  expect(await confirm(confirmLinkIn(mailTo(newEmail).text))).toEqual({ email: newEmail })
  await runQueuedJobs()
  expect(await rawUser(p.id)).toMatchObject({ email: newEmail, email_verified: true })
  // a notice once it is done, with the lock still at hand (no link to confirm anything)
  expect(mailsTo(p.email)).toHaveLength(warnings + 1)
  const notice = mailTo(p.email)
  expect(notice.subject).toBe("L'email del tuo account è cambiata · Feedway")
  expect(notice.text).toContain(`ora è ${newEmail}`)
  expect(notice.text).not.toContain('/conferma-email')
  expect(notice.text).toContain('/sicurezza/non-sono-stato-io?t=')
  // the other sessions stay signed in and see the new address
  expect((await sessionUser(other)).email).toBe(newEmail)
  const actions = (await auditActions(p.id)).map((e) => e.action)
  expect(actions).toContain('auth.email_change_requested')
  expect(actions).toContain('auth.email_changed')
  // the person signs in with the new address from now on
  expect((await post('/sign-in/email', { email: newEmail, password: PASSWORD }, '')).status).toBe(
    200,
  )
})

test('the confirmation link works once, and a newer request voids the older link', async () => {
  const p = await person()
  const cookie = await freshSignIn(p.email)
  const first = `primo-${p.id.slice(0, 8)}@esempio.it`
  const second = `secondo-${p.id.slice(0, 8)}@esempio.it`
  await changeEmail(cookie, first)
  await runQueuedJobs()
  const firstLink = confirmLinkIn(mailTo(first).text)
  await changeEmail(cookie, second)
  await runQueuedJobs()
  await expect(confirm(firstLink)).rejects.toMatchObject({ code: 'LINK_INVALID' })
  const secondLink = confirmLinkIn(mailTo(second).text)
  await confirm(secondLink)
  await expect(confirm(secondLink)).rejects.toMatchObject({ code: 'LINK_INVALID' })
  expect((await rawUser(p.id))?.email).toBe(second)
})

test('an expired or forged link changes nothing', async () => {
  const p = await person()
  const cookie = await freshSignIn(p.email)
  const target = `scade-${p.id.slice(0, 8)}@esempio.it`
  await changeEmail(cookie, target)
  await runQueuedJobs()
  const link = confirmLinkIn(mailTo(target).text)
  const later = fixedClock(new Date(Date.now() + 61 * 60_000))
  await expect(confirm(link, later)).rejects.toMatchObject({ code: 'LINK_INVALID' })
  const [userId] = link.split('.')
  for (const forged of [
    `${String(userId)}.${'A'.repeat(43)}`,
    `${randomUUID()}.${link.split('.')[1] ?? ''}`,
    'nonsense',
    '',
  ])
    await expect(confirm(forged)).rejects.toMatchObject({ code: 'LINK_INVALID' })
  expect((await rawUser(p.id))?.email).toBe(p.email)
})

test('"Non sono stato io" in the warning cancels the pending change and locks the account', async () => {
  const p = await person()
  const newEmail = `intruso-${p.id.slice(0, 8)}@esempio.it`
  const cookie = await freshSignIn(p.email)
  await changeEmail(cookie, newEmail)
  await runQueuedJobs()
  await lockAccountFromSecurityEmail(
    { uow, tokens: signedTokens, clock: systemClock, queue },
    { token: lockTokenIn(mailTo(p.email).text), ip: null },
  )
  expect(await rawUser(p.id)).toMatchObject({ email: p.email, status: 'disabled' })
  // the confirmation no longer works
  await expect(confirm(confirmLinkIn(mailTo(newEmail).text))).rejects.toMatchObject({
    code: 'LINK_INVALID',
  })
  expect((await rawUser(p.id))?.email).toBe(p.email)
})

test('a job for a change that was cancelled sends nothing', async () => {
  const p = await person()
  const newEmail = `annullato-${p.id.slice(0, 8)}@esempio.it`
  const cookie = await freshSignIn(p.email)
  await changeEmail(cookie, newEmail)
  await admin.query("delete from verifications where identifier = 'email-change:' || $1", [p.id])
  await runQueuedJobs()
  expect(mailsTo(newEmail)).toEqual([])
})

test('address already in use gets the same answer and no mail, but the old address is warned', async () => {
  const taken = await person()
  const p = await person()
  const cookie = await freshSignIn(p.email)
  const before = mailsTo(p.email).length
  const r = await changeEmail(cookie, taken.email)
  expect(r.status).toBe(200)
  expect(await r.json()).toEqual({ status: true })
  await runQueuedJobs()
  expect(mailsTo(taken.email)).toHaveLength(0)
  expect(mailsTo(p.email)).toHaveLength(before + 1)
  expect(mailTo(p.email).subject).toMatch(/cambiare l'email/i)
})

test('the link to the new address is ours: no redirect target from the browser, no verify-email', async () => {
  const p = await person()
  const newEmail = `richiamo-${p.id.slice(0, 8)}@esempio.it`
  const cookie = await freshSignIn(p.email)
  await changeEmail(cookie, newEmail, { callbackURL: 'https://evil.example/' })
  await runQueuedJobs()
  expect(mailTo(newEmail).text).not.toContain('evil.example')
  expect(mailTo(newEmail).text).toContain(`${PANEL}/conferma-email?t=${p.id}.`)
  const verify = await instance.handler(
    new Request(`${PANEL}/api/auth/verify-email?token=x`, {
      headers: { 'x-app-client-ip': nextIp() },
    }),
  )
  expect(verify.status).toBe(404)
})

test('a person may ask at most five changes an hour', async () => {
  const p = await person()
  const cookie = await freshSignIn(p.email)
  for (let n = 0; n < 5; n++)
    expect(
      (await changeEmail(cookie, `limite-${String(n)}-${p.id.slice(0, 8)}@esempio.it`)).status,
    ).toBe(200)
  const sixth = await changeEmail(cookie, `limite-5-${p.id.slice(0, 8)}@esempio.it`)
  expect(sixth.status).toBe(429)
  expect(await sixth.json()).toMatchObject({ code: 'RATE_LIMITED' })
})

test('"Password dimenticata" says when email cannot leave, the same for any address', async () => {
  const p = await person()
  mailConfigured = false
  const known = await post(
    '/request-password-reset',
    { email: p.email, redirectTo: '/reimposta' },
    '',
  )
  const unknown = await post(
    '/request-password-reset',
    { email: 'nessuno-qui@esempio.it', redirectTo: '/reimposta' },
    '',
  )
  expect(known.status).toBe(409)
  expect(await known.json()).toMatchObject({ code: 'MAIL_NOT_CONFIGURED' })
  expect(unknown.status).toBe(409)
  expect(queued).toEqual([])

  mailConfigured = true
  const sent = await post(
    '/request-password-reset',
    { email: p.email, redirectTo: '/reimposta' },
    '',
  )
  expect(sent.status).toBe(200)
  expect(queued.map((q) => q.name)).toEqual(['identity.password_reset_email'])
})

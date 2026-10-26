import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  lockAccountFromSecurityEmail,
  SECURITY_EMAIL_KINDS,
  type Logger,
  type Mailer,
  type SecurityEmailData,
} from '@app/application'
import {
  createLogger,
  createMemoryMailer,
  createRuntime,
  notConfiguredMailer,
} from '@app/infrastructure'
import type { Runtime } from '@app/infrastructure'
import { fixedClock, seed, startTestDatabase } from '@app/infrastructure/testing'
import type { TestDatabase } from '@app/infrastructure/testing'
import { createTranslate, loadItalianMessages } from '../i18n.js'
import type { JobHandlerDeps } from '../job-handler.js'
import { identitySecurityEmail } from './identity-security-email.js'

const PANEL = new URL('https://pannello.example.test')
const occurredAt = '2026-10-19T08:30:00.000Z'

let tdb: TestDatabase
let runtime: Runtime
let admin: pg.Client
let mediaRoot: string

beforeAll(async () => {
  tdb = await startTestDatabase()
  mediaRoot = await mkdtemp(join(tmpdir(), 'security-email-'))
  runtime = await createRuntime(
    {
      nodeEnv: 'production',
      databaseUrl: tdb.runtimeUrl,
      encryptionKey: randomBytes(32),
      logLevel: 'error',
      mediaRoot,
    },
    'worker',
  )
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
})
afterAll(async () => {
  await admin.end()
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 })
  await runtime.close()
  await rm(mediaRoot, { recursive: true, force: true })
  await tdb.stop()
})

function depsWith(mailer: Mailer, logger: Logger = runtime.logger): JobHandlerDeps {
  return {
    logger,
    uow: runtime.uow,
    clock: runtime.clock,
    ids: runtime.ids,
    storage: runtime.storage,
    mailer,
    signedTokens: runtime.signedTokens,
    translate: createTranslate(loadItalianMessages()),
    panel: { url: PANEL, productName: 'Feedway', defaultTimezone: 'Europe/Rome' },
  }
}

async function newUserWithSessions(sessions: number) {
  const email = `sicurezza-${randomUUID().slice(0, 8)}@example.test`
  const userId = await seed(tdb.runtimeUrl, (s) => s.user({ email }))
  for (let n = 0; n < sessions; n++) {
    await admin.query(
      `insert into sessions (id, token, user_id, expires_at, updated_at)
       values ($1, $2, $3, now() + interval '1 hour', now())`,
      [randomUUID(), randomUUID(), userId],
    )
  }
  return { userId, email }
}

const job = (userId: string, data: Partial<SecurityEmailData> = {}) => ({
  id: randomUUID(),
  data: {
    userId,
    kind: 'new_device' as const,
    occurredAt,
    deviceLabel: 'Safari su iOS',
    ip: '93.41.12.200',
    ...data,
  },
})

const tokenFrom = (text: string) => {
  const match = /non-sono-stato-io\?t=([A-Za-z0-9._-]+)/.exec(text)
  if (!match?.[1]) throw new Error('no lock link in the email')
  return match[1]
}

test('security email goes to the user with a working lock link', async () => {
  const { userId, email } = await newUserWithSessions(2)
  const mailer = createMemoryMailer()
  await identitySecurityEmail(job(userId), depsWith(mailer))
  const mail = mailer.sent.at(-1)
  expect(mail?.to).toBe(email)
  expect(mail?.subject).toBe('Nuovo accesso al tuo account Feedway')
  // shortened address, Rome time, the readable device, never the full IP
  expect(mail?.text).toContain('Rete (approssimativa): 93.41.12.0')
  expect(mail?.text).not.toContain('93.41.12.200')
  expect(mail?.text).toMatch(/Quando: \S+ \d+ \S+ \d{4} alle 10:30 \(ora italiana\)/)
  expect(mail?.text).toContain('Dispositivo: Safari su iOS')
  expect(mail?.text).not.toContain('Luogo')
  expect(mail?.text).toContain(
    `Non sono stato io, blocca l'account:\n${PANEL.origin}/sicurezza/non-sono-stato-io?t=`,
  )
  expect(mail?.text).toContain('Il link funziona per 7 giorni.')
  expect(mail?.text).toContain('Gli avvisi di sicurezza non si possono disattivare.')
  expect(mail?.html).toMatch(
    /<a href="https:\/\/pannello\.example\.test\/sicurezza\/non-sono-stato-io\?t=/,
  )
  expect(mail?.html).toContain('bgcolor="#B3261E"')

  const token = tokenFrom(mail?.text ?? '')
  const deps = { uow: runtime.uow, tokens: runtime.signedTokens, clock: runtime.clock }
  await lockAccountFromSecurityEmail(deps, { token, ip: '93.41.12.200' })
  const { rows } = await admin.query<{ status: string; sessions: string }>(
    'select status, (select count(*) from sessions where user_id = $1) as sessions from users where id = $1',
    [userId],
  )
  expect(rows[0]).toEqual({ status: 'disabled', sessions: '0' })
  await expect(lockAccountFromSecurityEmail(deps, { token, ip: null })).resolves.toBeUndefined()
})

test('the lock link expires after seven days', async () => {
  const { userId } = await newUserWithSessions(0)
  const mailer = createMemoryMailer()
  await identitySecurityEmail(job(userId), depsWith(mailer))
  const token = tokenFrom(mailer.sent.at(-1)?.text ?? '')
  const clock = fixedClock(new Date(Date.now() + 8 * 86_400_000))
  await expect(
    lockAccountFromSecurityEmail(
      { uow: runtime.uow, tokens: runtime.signedTokens, clock },
      { token, ip: null },
    ),
  ).rejects.toMatchObject({ code: 'LINK_INVALID' })
})

test('values are escaped in the html version', async () => {
  const { userId } = await newUserWithSessions(0)
  const mailer = createMemoryMailer()
  await identitySecurityEmail(job(userId, { deviceLabel: '<script>x</script>' }), depsWith(mailer))
  const mail = mailer.sent.at(-1)
  expect(mail?.html).not.toContain('<script>')
  expect(mail?.html).toContain('&lt;script&gt;')
})

test('the time is written in the person’s time zone, named when it is not Rome', async () => {
  const { userId } = await newUserWithSessions(0)
  await admin.query("update users set timezone = 'America/New_York' where id = $1", [userId])
  const mailer = createMemoryMailer()
  await identitySecurityEmail(job(userId), depsWith(mailer))
  expect(mailer.sent.at(-1)?.text).toMatch(/alle \d\d:30 \(fuso orario: America\/New_York\)/)
})

test.each(SECURITY_EMAIL_KINDS)(
  'the %s email has its own title and the lock button',
  async (kind) => {
    const { userId } = await newUserWithSessions(0)
    const mailer = createMemoryMailer()
    await identitySecurityEmail(job(userId, { kind }), depsWith(mailer))
    const mail = mailer.sent.at(-1)
    expect(mail?.subject).toContain('Feedway')
    expect(mail?.text).toContain("Non sono stato io, blocca l'account:")
    expect(mail?.html).toContain('Rete (approssimativa)')
  },
)

test('not configured mailer completes the job and logs it', async () => {
  const { userId } = await newUserWithSessions(0)
  const infos: string[] = []
  const quiet = createLogger({ service: 'worker', level: 'error' })
  const logger: Logger = {
    ...quiet,
    info(_fields, message) {
      infos.push(message ?? '')
    },
  }
  await expect(
    identitySecurityEmail(
      job(userId, { kind: 'password_changed' }),
      depsWith(notConfiguredMailer, logger),
    ),
  ).resolves.toBeUndefined()
  expect(infos).toContain('security email not sent: not_configured')
})

test('an anonymized person gets no email', async () => {
  const { userId } = await newUserWithSessions(0)
  await admin.query('update users set anonymized_at = now() where id = $1', [userId])
  const mailer = createMemoryMailer()
  await identitySecurityEmail(job(userId), depsWith(mailer))
  expect(mailer.sent).toEqual([])
})

test('an email change notice goes to the address it names, not the new one', async () => {
  const { userId } = await newUserWithSessions(0)
  const mailer = createMemoryMailer()
  await identitySecurityEmail(
    job(userId, { kind: 'email_changed', notifyEmail: 'vecchio@example.test' }),
    depsWith(mailer),
  )
  expect(mailer.sent.at(-1)?.to).toBe('vecchio@example.test')
})

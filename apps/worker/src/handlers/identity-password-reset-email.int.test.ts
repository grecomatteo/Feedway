import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { Logger, Mailer } from '@app/application'
import {
  createLogger,
  createMemoryMailer,
  createRuntime,
  notConfiguredMailer,
} from '@app/infrastructure'
import type { Runtime } from '@app/infrastructure'
import { seed, startTestDatabase } from '@app/infrastructure/testing'
import type { TestDatabase } from '@app/infrastructure/testing'
import { createTranslate, loadItalianMessages } from '../i18n.js'
import type { JobHandlerDeps } from '../job-handler.js'
import { identityPasswordResetEmail } from './identity-password-reset-email.js'

const PANEL = new URL('https://pannello.example.test')
const RESET_URL = `${PANEL.origin}/api/auth/reset-password/abc123?callbackURL=%2Freimposta`

let tdb: TestDatabase
let runtime: Runtime
let admin: pg.Client
let mediaRoot: string

beforeAll(async () => {
  tdb = await startTestDatabase()
  mediaRoot = await mkdtemp(join(tmpdir(), 'reset-email-'))
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

async function newUser() {
  const email = `reset-${randomUUID().slice(0, 8)}@example.test`
  const userId = await seed(tdb.runtimeUrl, (s) => s.user({ email }))
  return { userId, email }
}

const job = (userId: string) => ({ id: randomUUID(), data: { userId, url: RESET_URL } })

test('the reset email goes to the account with the link', async () => {
  const { userId, email } = await newUser()
  const mailer = createMemoryMailer()
  await identityPasswordResetEmail(job(userId), depsWith(mailer))
  const mail = mailer.sent.at(-1)
  expect(mail?.to).toBe(email)
  expect(mail?.subject).toContain('Feedway')
  expect(mail?.text).toContain(RESET_URL)
  expect(mail?.html).toContain(`<a href="${RESET_URL.replace('&', '&amp;')}">`)
})

test('without email configured the job completes, and the link is never logged', async () => {
  const { userId } = await newUser()
  const lines: string[] = []
  const quiet = createLogger({ service: 'worker', level: 'error' })
  const logger: Logger = {
    ...quiet,
    info(fields, message) {
      lines.push(`${message ?? ''} ${JSON.stringify(fields)}`)
    },
  }
  await expect(
    identityPasswordResetEmail(job(userId), depsWith(notConfiguredMailer, logger)),
  ).resolves.toBeUndefined()
  expect(lines.some((l) => l.includes('password reset email not sent: not_configured'))).toBe(true)
  expect(lines.join('\n')).not.toContain('abc123')
})

test('a disabled or anonymized account gets no reset email', async () => {
  const disabled = await newUser()
  await admin.query("update users set status = 'disabled' where id = $1", [disabled.userId])
  const anonymized = await newUser()
  await admin.query('update users set anonymized_at = now() where id = $1', [anonymized.userId])
  const mailer = createMemoryMailer()
  await identityPasswordResetEmail(job(disabled.userId), depsWith(mailer))
  await identityPasswordResetEmail(job(anonymized.userId), depsWith(mailer))
  expect(mailer.sent).toEqual([])
})

test('a failing mailer fails the job (it is retried) and the link stays out of the log', async () => {
  const { userId } = await newUser()
  const lines: string[] = []
  const quiet = createLogger({ service: 'worker', level: 'error' })
  const keep = (fields: unknown, message?: string) => {
    lines.push(`${message ?? ''} ${JSON.stringify(fields)}`)
  }
  const logger: Logger = { ...quiet, info: keep, warn: keep, error: keep }
  const failing: Mailer = {
    isConfigured: () => Promise.resolve(true),
    send: () => Promise.reject(new Error('smtp irraggiungibile')),
  }
  await expect(identityPasswordResetEmail(job(userId), depsWith(failing, logger))).rejects.toThrow(
    'smtp irraggiungibile',
  )
  expect(lines.join('\n')).not.toContain('abc123')
})

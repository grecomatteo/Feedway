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
import { fixedClock, seed, startTestDatabase } from '@app/infrastructure/testing'
import type { TestDatabase } from '@app/infrastructure/testing'
import { createTranslate, loadItalianMessages } from '../i18n.js'
import type { JobHandlerDeps } from '../job-handler.js'
import { identityAccountRecoveryEmail } from './identity-account-recovery-email.js'

const PANEL = new URL('https://pannello.example.test')
const SECRET = 'platform.segreto-di-prova'
const RECOVERY_URL = `${PANEL.origin}/api/auth/reset-password/${SECRET}?callbackURL=%2Freimposta`
// 19:20 in Rome; the link works until 19:50
const ISSUED = new Date('2026-10-26T18:20:00Z')

let tdb: TestDatabase
let runtime: Runtime
let admin: pg.Client
let mediaRoot: string

beforeAll(async () => {
  tdb = await startTestDatabase()
  mediaRoot = await mkdtemp(join(tmpdir(), 'recovery-email-'))
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

function depsWith(mailer: Mailer, logger: Logger = runtime.logger, at = ISSUED): JobHandlerDeps {
  return {
    queue: runtime.queue,
    logger,
    uow: runtime.uow,
    clock: fixedClock(at),
    ids: runtime.ids,
    storage: runtime.storage,
    mailer,
    signedTokens: runtime.signedTokens,
    translate: createTranslate(loadItalianMessages()),
    panel: { url: PANEL, productName: 'Feedway', defaultTimezone: 'Europe/Rome' },
  }
}

function recording() {
  const lines: string[] = []
  const quiet = createLogger({ service: 'worker', level: 'error' })
  const keep = (fields: unknown, message?: string) => {
    lines.push(`${message ?? ''} ${JSON.stringify(fields)}`)
  }
  const logger: Logger = { ...quiet, info: keep, warn: keep, error: keep }
  return { lines, logger }
}

async function newUser() {
  const email = `recupero-${randomUUID().slice(0, 8)}@example.test`
  const userId = await seed(tdb.runtimeUrl, (s) => s.user({ email }))
  return { userId, email }
}

const job = (userId: string) => ({
  id: randomUUID(),
  data: {
    userId,
    url: RECOVERY_URL,
    expiresAt: new Date(ISSUED.getTime() + 30 * 60_000).toISOString(),
  },
})

test('the recovery link goes to the account’s address, with its 30 minutes', async () => {
  const { userId, email } = await newUser()
  const mailer = createMemoryMailer()
  await identityAccountRecoveryEmail(job(userId), depsWith(mailer))
  const mail = mailer.sent.at(-1)
  expect(mail?.to).toBe(email)
  expect(mail?.subject).toBe('Scegli una nuova password per rientrare in Feedway')
  expect(mail?.text.split('\n')[0]).toBe('Scegli una nuova password per rientrare')
  expect(mail?.text).toContain(`Scegli una nuova password:\n${RECOVERY_URL}`)
  expect(mail?.text).toContain(
    'Il link scade tra 30 minuti: funziona una sola volta, fino alle 19:50 di oggi.',
  )
  expect(mail?.text).toContain(
    "Se non hai chiesto tu di riattivare l'account, non aprire il link e avvisa l'amministratore.",
  )
  // the link alone is enough (Matteo's choice of 27/10): no code is mentioned
  expect(mail?.text).not.toMatch(/codice/i)
  expect(mail?.text).toContain('Le passkey e la verifica in due passaggi sono state tolte:')
  // the orange button
  expect(mail?.html).toContain('bgcolor="#FF762E"')
  expect(mail?.html).toContain(`href="${RECOVERY_URL}"`)
})

test('a reactivation not committed yet is retried; an anonymized account gets nothing', async () => {
  const disabled = await newUser()
  await admin.query("update users set status = 'disabled' where id = $1", [disabled.userId])
  const mailer = createMemoryMailer()
  await expect(
    identityAccountRecoveryEmail(job(disabled.userId), depsWith(mailer)),
  ).rejects.toThrow()
  const anonymized = await newUser()
  await admin.query('update users set anonymized_at = now() where id = $1', [anonymized.userId])
  await identityAccountRecoveryEmail(job(anonymized.userId), depsWith(mailer))
  expect(mailer.sent).toEqual([])
})

test('an expired link is not sent, and the log holds nothing secret or personal', async () => {
  const { userId, email } = await newUser()
  const { lines, logger } = recording()
  const mailer = createMemoryMailer()
  const after = new Date(ISSUED.getTime() + 31 * 60_000)
  await identityAccountRecoveryEmail(job(userId), depsWith(mailer, logger, after))
  expect(mailer.sent).toEqual([])
  expect(lines.some((l) => l.includes('recovery email skipped: link expired'))).toBe(true)
  for (const secret of [SECRET, email, userId]) expect(lines.join('\n')).not.toContain(secret)
})

test('without email configured the job completes, and the link is never logged', async () => {
  const { userId } = await newUser()
  const { lines, logger } = recording()
  await expect(
    identityAccountRecoveryEmail(job(userId), depsWith(notConfiguredMailer, logger)),
  ).resolves.toBeUndefined()
  expect(lines.some((l) => l.includes('recovery email not sent: not_configured'))).toBe(true)
  expect(lines.join('\n')).not.toContain(SECRET)
})

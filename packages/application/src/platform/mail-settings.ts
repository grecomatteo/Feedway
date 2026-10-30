import { DomainError } from '@app/domain'
import { emailFrame, oneLine, renderEmail } from '../mail/index.js'
import type { AuthSessionInfo } from '../ports/auth.js'
import type { Clock } from '../ports/clock.js'
import type {
  IntegrationStore,
  MailSettingsSource,
  SmtpConfig,
  SmtpPort,
} from '../ports/integration-store.js'
import type { Logger } from '../ports/logger.js'
import { MailSendError } from '../ports/mailer.js'
import type { MailFailureKind, Mailer } from '../ports/mailer.js'
import type { RateLimiter } from '../ports/rate-limiter.js'
import type { Translate } from '../ports/translator.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { assertRecentReauth } from '../identity/index.js'
import {
  assertPlatform,
  callerIsSystem,
  platformAuthor,
  type PlatformCaller,
  type PlatformRequest,
} from './platform-actor.js'

export interface MailSettingsDeps {
  uow: UnitOfWork
  integrations: IntegrationStore
}

/**
 * The platform's SMTP settings, read in the system scope at every send: the worker sends with
 * no user, and the platform rows are visible only there. Agencies configure nothing (ADR 017).
 */
export function createMailSettings(deps: MailSettingsDeps): MailSettingsSource {
  const { uow, integrations } = deps
  return {
    isConfigured: () =>
      uow.runAsSystem(
        'mail: is the platform SMTP set',
        async (tx) => (await integrations.getPlatform(tx, 'smtp')) !== null,
      ),
    credentials: () =>
      uow.runAsSystem('mail: platform SMTP for a send', (tx) =>
        integrations.platformCredentials(tx, 'smtp'),
      ),
  }
}

/** What the administrator manages: the settings, the mailer that tries them, the email's texts. */
export interface PlatformMailDeps extends MailSettingsDeps {
  clock: Clock
  rateLimiter: Pick<RateLimiter, 'hit'>
  mailer: Mailer
  translate: Translate
  logger: Logger
  panelUrl: URL
  productName: string
}

/**
 * A panel request also carries its session: changing the settings and sending a test need a
 * recent reauth. The command line has no session.
 */
export interface PlatformPanelRequest extends PlatformRequest {
  session: AuthSessionInfo | null
}

const FROM_CLI: PlatformPanelRequest = { ip: null, session: null }

/** What the panel and the CLI show: never the secret, not even part of it (ADR 017). */
export interface PlatformMailSettings {
  host: string
  port: SmtpPort
  security: SmtpConfig['security']
  username: string
  from: string
  secretSet: true
  verifiedAt: Date | null
  updatedAt: Date
}

export interface PlatformMailSettingsInput {
  host: string
  port: SmtpPort
  /** Left out: TLS on 465, STARTTLS on 587 and 2525. */
  security?: SmtpConfig['security']
  username: string
  from: string
  /** Left out: the stored one stays (only the settings change). */
  secret?: string
}

/** The fields an activity entry may name: the password counts as a name, never as a value. */
export type MailSettingsField = 'host' | 'port' | 'security' | 'username' | 'from' | 'password'

export type PlatformTestEmailKind = 'sent' | 'not_configured' | 'unexpected' | MailFailureKind

export interface PlatformTestEmailResult {
  ok: boolean
  kind: PlatformTestEmailKind
  /** The server's reply, already cleaned by the adapter (no credentials, no addresses). */
  response: string | null
}

/** Five tests every ten minutes for each administrator: each one is an email to an address. */
export const MAIL_TEST_RATE_LIMIT = { limit: 5, windowMs: 10 * 60_000 }

const ENTITY = 'integration'

function assertPanelReauth(
  deps: Pick<PlatformMailDeps, 'clock'>,
  caller: PlatformCaller,
  request: PlatformPanelRequest,
): void {
  if (callerIsSystem(caller)) return
  if (request.session === null)
    throw new DomainError('REAUTH_REQUIRED', 'Conferma la tua identità per continuare')
  // a session of someone else would confirm nothing about this caller
  if (request.session.userId !== caller.userId)
    throw new DomainError('FORBIDDEN', 'Solo l’amministratore della piattaforma può farlo')
  assertRecentReauth(request.session, deps.clock.now())
}

function viewOf(found: {
  config: SmtpConfig
  verifiedAt: Date | null
  updatedAt: Date
}): PlatformMailSettings {
  const { host, port, security, username, from } = found.config
  return {
    host,
    port,
    security,
    username,
    from,
    secretSet: true,
    verifiedAt: found.verifiedAt,
    updatedAt: found.updatedAt,
  }
}

/** The platform's SMTP as the administrator sees it; null when nothing is set yet. */
export async function getPlatformMailSettings(
  deps: Pick<PlatformMailDeps, 'uow' | 'integrations'>,
  caller: PlatformCaller,
  request: PlatformRequest = FROM_CLI,
): Promise<PlatformMailSettings | null> {
  assertPlatform(caller, 'platform.integrations.manage')
  return deps.uow.runAsSystem('platform: read the system email settings', async (tx) => {
    await platformAuthor(tx, caller, request)
    const found = await deps.integrations.getPlatform(tx, 'smtp')
    return found === null ? null : viewOf(found)
  })
}

const defaultSecurity = (port: SmtpPort): SmtpConfig['security'] =>
  port === 465 ? 'tls' : 'starttls'

/**
 * Replaces the platform's SMTP. The adapter's parser checks the settings (`VALIDATION`); the
 * password may be left out when one is stored. A change resets the verification; the activity
 * entry, in the same transaction, names the fields that changed and nothing else.
 */
export async function replacePlatformMailSettings(
  deps: Pick<PlatformMailDeps, 'uow' | 'integrations' | 'clock'>,
  caller: PlatformCaller,
  input: PlatformMailSettingsInput,
  request: PlatformPanelRequest = FROM_CLI,
): Promise<PlatformMailSettings> {
  assertPlatform(caller, 'platform.integrations.manage')
  assertPanelReauth(deps, caller, request)
  const config: SmtpConfig = {
    // compared as the store keeps it
    host: input.host.trim().toLowerCase(),
    port: input.port,
    security: input.security ?? defaultSecurity(input.port),
    username: input.username,
    from: input.from,
  }
  return deps.uow.runAsSystem('platform: change the system email settings', async (tx) => {
    const author = await platformAuthor(tx, caller, request)
    const stored = await deps.integrations.platformCredentials(tx, 'smtp')
    const secret = input.secret ?? stored?.secret
    if (secret === undefined)
      throw new DomainError('VALIDATION', 'Serve la password del server SMTP', {
        field: 'password',
      })
    const fields: MailSettingsField[] = (
      ['host', 'port', 'security', 'username', 'from'] as const
    ).filter((field) => stored?.config[field] !== config[field])
    if (stored === null || secret !== stored.secret) fields.push('password')
    if (fields.length === 0) {
      const current = await deps.integrations.getPlatform(tx, 'smtp')
      if (current !== null) return viewOf(current)
    }
    const view = await deps.integrations.replacePlatform(tx, 'smtp', {
      config,
      secret,
      updatedBy: author.actorId,
    })
    await tx.audit.record({
      organizationId: null,
      actorId: author.actorId,
      source: author.source,
      action: 'platform.mail_settings_changed',
      entity: ENTITY,
      entityId: null,
      workspaceId: null,
      ip: author.ip,
      data: { fields },
    })
    return viewOf(view)
  })
}

// one plain address: the adapter checks it again before any header is written
const PLAIN_ADDRESS = /^[^\s@,;:<>()"[\]\\]+@[^\s@,;:<>()"[\]\\]+\.[^\s@,;:<>()"[\]\\]+$/

/**
 * Sends a test email with the stored settings. Success marks them as verified, unless they
 * changed while the email was leaving. The answer is classified: the kind and the server's
 * reply as the adapter cleaned it, never anything raw. Recorded with `{ ok, kind }`.
 */
export async function sendPlatformTestEmail(
  deps: PlatformMailDeps,
  caller: PlatformCaller,
  to: string,
  request: PlatformPanelRequest = FROM_CLI,
): Promise<PlatformTestEmailResult> {
  assertPlatform(caller, 'platform.integrations.manage')
  assertPanelReauth(deps, caller, request)
  const address = to.trim()
  if (address.length > 254 || !PLAIN_ADDRESS.test(address))
    throw new DomainError('VALIDATION', 'Indirizzo email non valido', { field: 'to' })
  if (!callerIsSystem(caller)) {
    const { allowed, retryAfterMs } = await deps.rateLimiter.hit(
      `mail-test:${caller.userId}`,
      MAIL_TEST_RATE_LIMIT.limit,
      MAIL_TEST_RATE_LIMIT.windowMs,
    )
    if (!allowed)
      throw new DomainError('RATE_LIMITED', 'Troppe email di prova. Riprova più tardi.', {
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      })
  }
  const tried = await deps.uow.runAsSystem('platform: system email before a test', async (tx) => {
    await platformAuthor(tx, caller, request)
    return deps.integrations.getPlatform(tx, 'smtp')
  })

  let result: PlatformTestEmailResult
  if (tried === null) result = { ok: false, kind: 'not_configured', response: null }
  else {
    try {
      const sent = await deps.mailer.send(testMessage(deps, address))
      result =
        sent === 'sent'
          ? { ok: true, kind: 'sent', response: null }
          : { ok: false, kind: 'not_configured', response: null }
    } catch (error) {
      if (error instanceof MailSendError)
        result = { ok: false, kind: error.kind, response: error.response ?? null }
      else {
        // never the error itself: a driver's message may carry what we keep out of the logs
        deps.logger.warn({ kind: 'unexpected' }, 'test email failed')
        result = { ok: false, kind: 'unexpected', response: null }
      }
    }
  }

  await deps.uow.runAsSystem('platform: record a system email test', async (tx) => {
    const author = await platformAuthor(tx, caller, request)
    if (result.ok && tried !== null)
      await tx.integrations.markPlatformVerified('smtp', deps.clock.now(), tried.updatedAt)
    await tx.audit.record({
      organizationId: null,
      actorId: author.actorId,
      source: author.source,
      action: 'platform.mail_test_sent',
      entity: ENTITY,
      entityId: null,
      workspaceId: null,
      ip: author.ip,
      data: { ok: result.ok, kind: result.kind },
    })
  })
  return result
}

function testMessage(
  deps: Pick<PlatformMailDeps, 'translate' | 'panelUrl' | 'productName'>,
  to: string,
) {
  const t = deps.translate
  const values = { product: deps.productName }
  const { html, text } = renderEmail({
    ...emailFrame(t, deps.panelUrl, deps.productName),
    preheader: t('email.mailTest.preheader', values),
    title: t('email.mailTest.title', values),
    blocks: [{ kind: 'paragraph', text: t('email.mailTest.intro', values) }],
    footerReason: t('email.mailTest.footer', values),
  })
  return { to, subject: oneLine(t('email.mailTest.subject', values)), text, html }
}

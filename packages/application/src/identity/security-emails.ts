import { shortenIp } from '@app/domain'
import type { Clock } from '../ports/clock.js'
import type { SecurityEmailData } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { Mailer, MailMessage } from '../ports/mailer.js'
import type { SignedTokens } from '../ports/token-service.js'
import type { Translate } from '../ports/translator.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

/** How long the "Non sono stato io" link in a security email works. */
export const LOCK_LINK_TTL_MS = 7 * 86_400_000

export const LOCK_PAGE_PATH = '/sicurezza/non-sono-stato-io'

export interface SecurityEmailDeps {
  uow: UnitOfWork
  mailer: Mailer
  tokens: SignedTokens
  clock: Clock
  translate: Translate
  logger: Logger
  panelUrl: URL
  productName: string
  /** Used when the person has not chosen a time zone. */
  defaultTimezone: string
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c)

/**
 * The HTML version is built from the plain text (the panel's message compiler rejects HTML in
 * it.json): every value is escaped, paragraphs become `<p>` and the value named `linkName`
 * an `<a>`.
 */
export function emailHtml(
  translate: Translate,
  key: string,
  values: Record<string, string>,
  linkName: string,
): string {
  const marks = Object.fromEntries(Object.keys(values).map((name) => [name, `\uE000${name}\uE000`]))
  const template = escapeHtml(translate(key, marks))
  const filled = template.replace(/\uE000(\w+)\uE000/g, (_, name: string) => {
    const value = escapeHtml(values[name] ?? '')
    return name === linkName ? `<a href="${value}">${value}</a>` : value
  })
  return filled
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}

/** A date and time as the emails write it, in Italian. */
export function formatWhen(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone,
  }).format(at)
}

/**
 * Job `identity.security_email`: tells the person about a sign-in from a new device or a
 * change to their credentials, with a link that locks the account if it was not them.
 */
export async function sendSecurityEmail(
  deps: SecurityEmailDeps,
  job: SecurityEmailData & { userId: string },
): Promise<void> {
  const user = await deps.uow.run({ userId: job.userId }, (tx) => tx.users.findById(job.userId))
  if (user === null || user.anonymizedAt !== null) {
    deps.logger.info({ kind: job.kind }, 'security email skipped: account gone')
    return
  }
  const now = deps.clock.now()
  const token = deps.tokens.sign('security_lock', {
    userId: user.id,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + LOCK_LINK_TTL_MS),
  })
  const lockUrl = new URL(LOCK_PAGE_PATH, deps.panelUrl)
  lockUrl.searchParams.set('t', token)
  const shortIp = job.ip === null ? '' : shortenIp(job.ip)
  const values = {
    product: deps.productName,
    device: job.deviceLabel,
    ip: shortIp === '' ? deps.translate('email.security.unknownIp') : shortIp,
    when: formatWhen(new Date(job.occurredAt), user.timezone ?? deps.defaultTimezone),
    lockUrl: lockUrl.toString(),
  }
  const base = `email.security.${job.kind}`
  const message: MailMessage = {
    to: job.notifyEmail ?? user.email,
    subject: deps.translate(`${base}.subject`, values),
    text: deps.translate(`${base}.text`, values),
    html: emailHtml(deps.translate, `${base}.text`, values, 'lockUrl'),
  }
  const result = await deps.mailer.send(message)
  if (result === 'not_configured') {
    // Expected until stage 3 configures email: the event is in the activity log anyway.
    deps.logger.info({ kind: job.kind }, 'security email not sent: not_configured')
  }
}

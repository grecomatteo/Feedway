import { DomainError, shortenIp } from '@app/domain'
import type { Clock } from '../ports/clock.js'
import type { EmailChangeEmailData, JobQueue } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { Mailer } from '../ports/mailer.js'
import type { TokenService } from '../ports/token-service.js'
import type { Translate } from '../ports/translator.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import {
  dayAndTime,
  emailFrame,
  isSameDay,
  oneLine,
  renderEmail,
  usableTimeZone,
} from '../mail/index.js'
import { readableDevice } from './auth-events.js'
import { isUuid } from './member-rules.js'

/** How long the link to the new address works; the job holding it is kept as long. */
export const EMAIL_CHANGE_TTL_MS = 3600_000

/** The panel page the link of E5 opens, with `?t=…`. */
export const EMAIL_CHANGE_PAGE_PATH = '/conferma-email'

export interface StartEmailChangeDeps {
  uow: UnitOfWork
  queue: Pick<JobQueue, 'send'>
  tokens: TokenService
  clock: Clock
  panelUrl: URL
}

/**
 * Called by Better Auth's `/change-email` once it has checked the session, the reauth and the
 * address (auth-hooks.ts), and only when no other account has the address. Replaces any change
 * still pending and queues E5 to the new address. The warning to the old one (E5b) is the
 * `email_change_requested` event, sent whether or not the address is free.
 */
export async function startEmailChange(
  deps: StartEmailChangeDeps,
  input: { userId: string; newEmail: string },
): Promise<void> {
  const { userId } = input
  const to = input.newEmail.toLowerCase()
  const { token, hash } = deps.tokens.generate()
  const expiresAt = new Date(deps.clock.now().getTime() + EMAIL_CHANGE_TTL_MS)
  await deps.uow.run({ userId }, (tx) =>
    tx.emailChanges.replace(userId, { to, tokenHash: hash, expiresAt }),
  )
  const url = new URL(EMAIL_CHANGE_PAGE_PATH, deps.panelUrl)
  // the person's id opens their own scope; the random part is what proves the link
  url.searchParams.set('t', `${userId}.${token}`)
  await deps.queue.send('identity.email_change', {
    userId,
    to,
    url: url.toString(),
    expiresAt: expiresAt.toISOString(),
  })
}

export interface ConfirmEmailChangeDeps {
  uow: UnitOfWork
  queue: Pick<JobQueue, 'send'>
  tokens: TokenService
  clock: Clock
}

const linkInvalid = () =>
  new DomainError(
    'LINK_INVALID',
    'Il link non è valido o è scaduto: chiedi di nuovo il cambio dalla pagina del tuo account',
  )

function parseToken(raw: string): { userId: string; secret: string } | null {
  const dot = raw.indexOf('.')
  if (dot <= 0) return null
  const userId = raw.slice(0, dot)
  const secret = raw.slice(dot + 1)
  if (!isUuid(userId) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null
  return { userId, secret }
}

/**
 * The link of E5, opened from the new mailbox, with or without a session: no session is opened
 * by it. The change happens only if it is still the person's latest request, within the hour,
 * on an active account: "Non sono stato io" deletes the pending change. The other sessions stay
 * signed in; the old address gets a short notice without links.
 */
export async function confirmEmailChange(
  deps: ConfirmEmailChangeDeps,
  input: { token: string; ip: string | null; userAgent: string | null },
): Promise<{ email: string }> {
  const parsed = parseToken(input.token)
  if (parsed === null) throw linkInvalid()
  const { userId } = parsed
  const now = deps.clock.now()
  const done = await deps.uow.run({ userId }, async (tx) => {
    const pending = await tx.emailChanges.findByToken(userId, deps.tokens.hash(parsed.secret), now)
    if (pending === null) return null
    const user = await tx.users.findByIdForUpdate(userId)
    if (
      user === null ||
      user.status !== 'active' ||
      user.anonymizedAt !== null ||
      user.securityLockedAt !== null
    )
      return null
    // used once: from here on the link no longer works, whatever happens next
    await tx.emailChanges.deleteForUser(userId)
    if (user.email.toLowerCase() === pending.to) return { previous: user.email, to: pending.to }
    if ((await tx.users.changeEmail(userId, pending.to)) === 'taken') return 'taken' as const
    await tx.audit.record({
      organizationId: null,
      actorId: userId,
      source: 'panel',
      action: 'auth.email_changed',
      entity: 'user',
      entityId: userId,
      workspaceId: null,
      ip: input.ip,
    })
    return { previous: user.email, to: pending.to }
  })
  if (done === null) throw linkInvalid()
  if (done === 'taken')
    throw new DomainError(
      'CONFLICT',
      'Questo indirizzo ora è usato da un altro account: chiedi il cambio con un altro indirizzo',
    )
  if (done.previous.toLowerCase() !== done.to)
    await deps.queue.send('identity.security_email', {
      userId,
      kind: 'email_changed',
      occurredAt: now.toISOString(),
      deviceLabel: readableDevice(input.userAgent),
      // job data outlives the audit IP shortening (§15.7): only the short form
      ip: input.ip === null ? null : shortenIp(input.ip) || null,
      notifyEmail: done.previous,
      newEmail: done.to,
    })
  return { email: done.to }
}

export interface EmailChangeEmailDeps {
  uow: UnitOfWork
  mailer: Mailer
  translate: Translate
  logger: Logger
  clock: Clock
  panelUrl: URL
  productName: string
  /** Used when the person has not chosen a time zone. */
  defaultTimezone: string
}

/**
 * Job `identity.email_change` (E5): the confirmation link to the new address. Nothing leaves
 * once the change is no longer pending (confirmed, replaced, cancelled by a lock) or the account
 * is not active. The link is never logged.
 */
export async function sendEmailChangeEmail(
  deps: EmailChangeEmailDeps,
  job: EmailChangeEmailData & { userId: string },
): Promise<void> {
  const now = deps.clock.now()
  const found = await deps.uow.run({ userId: job.userId }, async (tx) => ({
    user: await tx.users.findById(job.userId),
    pending: await tx.emailChanges.findForUser(job.userId, now),
  }))
  const { user, pending } = found
  if (user === null || user.status !== 'active' || user.anonymizedAt !== null) {
    deps.logger.info({}, 'email change email skipped: account not active')
    return
  }
  if (pending === null || pending.to !== job.to.toLowerCase()) {
    deps.logger.info({}, 'email change email skipped: no longer pending')
    return
  }
  const expiresAt = new Date(job.expiresAt)
  const minutesLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / 60_000)
  if (!(minutesLeft > 0)) {
    deps.logger.info({}, 'email change email skipped: link expired')
    return
  }
  const t = deps.translate
  const timeZone = usableTimeZone(user.timezone ?? deps.defaultTimezone, 'Europe/Rome')
  const { time } = dayAndTime(expiresAt, timeZone)
  const values = {
    product: deps.productName,
    oldEmail: user.email,
    newEmail: pending.to,
    minutes: String(minutesLeft),
    time,
  }
  const today = isSameDay(now, expiresAt, timeZone)
  const { html, text } = renderEmail({
    ...emailFrame(t, deps.panelUrl, deps.productName),
    preheader: t('email.emailChange.preheader', values),
    title: t('email.emailChange.title', values),
    blocks: [
      { kind: 'paragraph', text: t('email.emailChange.intro', values) },
      { kind: 'paragraph', text: t('email.emailChange.pending', values) },
      { kind: 'button', label: t('email.emailChange.button'), url: job.url, tone: 'primary' },
      {
        kind: 'box',
        tone: 'info',
        title: t('email.emailChange.warnedTitle', values),
        text: t(`email.emailChange.${today ? 'warnedToday' : 'warnedTomorrow'}`, values),
      },
      { kind: 'paragraph', text: t('email.emailChange.notMe', values), tone: 'muted' },
    ],
    footerReason: t('email.emailChange.footer', values),
  })
  const result = await deps.mailer.send({
    to: pending.to,
    subject: oneLine(t('email.emailChange.subject', values)),
    text,
    html,
  })
  if (result === 'not_configured')
    deps.logger.info({}, 'email change email not sent: not_configured')
}

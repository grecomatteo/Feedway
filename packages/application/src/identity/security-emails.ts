import { shortenIp } from '@app/domain'
import type { Clock } from '../ports/clock.js'
import type { SecurityEmailData } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { Mailer, MailMessage } from '../ports/mailer.js'
import type { SignedTokens } from '../ports/token-service.js'
import type { Translate } from '../ports/translator.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import {
  capitalize,
  dayAndTime,
  emailFrame,
  oneLine,
  renderEmail,
  usableTimeZone,
} from '../mail/index.js'

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

/** The fall-back time zone the emails name as "ora italiana". */
const ROME = 'Europe/Rome'

/**
 * "lunedì 26 ottobre 2026 alle 19:20 (ora italiana)" and, for the preheader,
 * "Lunedì 26 ottobre alle 19:20", in the person's time zone.
 */
function securityWhen(
  translate: Translate,
  at: Date,
  timeZone: string,
): { when: string; whenShort: string } {
  const full = dayAndTime(at, timeZone, { year: true })
  const short = dayAndTime(at, timeZone)
  const atText = translate('email.date.dayAt', full)
  return {
    when:
      timeZone === ROME
        ? translate('email.security.whenRome', { at: atText })
        : translate('email.security.whenZone', { at: atText, zone: timeZone }),
    whenShort: capitalize(translate('email.date.dayAt', short)),
  }
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
  const t = deps.translate
  const timeZone = usableTimeZone(user.timezone ?? deps.defaultTimezone, ROME)
  const values = {
    product: deps.productName,
    device: job.deviceLabel,
    ...securityWhen(t, new Date(job.occurredAt), timeZone),
  }
  const base = `email.security.${job.kind}`
  const { html, text } = renderEmail({
    ...emailFrame(t, deps.panelUrl, deps.productName),
    preheader: t(`${base}.preheader`, values),
    title: t(`${base}.title`, values),
    blocks: [
      { kind: 'paragraph', text: t(`${base}.intro`, values) },
      {
        kind: 'details',
        rows: [
          { label: t('email.security.labels.when'), value: values.when },
          { label: t('email.security.labels.device'), value: job.deviceLabel },
          {
            label: t('email.security.labels.network'),
            value: shortIp === '' ? t('email.security.unknownIp') : shortIp,
          },
        ],
      },
      {
        kind: 'lead',
        lead: t('email.security.itWasMe.lead'),
        text: t('email.security.itWasMe.text'),
      },
      {
        kind: 'lead',
        lead: t('email.security.notMe.lead'),
        text: t('email.security.lockExplain'),
      },
      {
        kind: 'button',
        label: t('email.security.lockButton'),
        url: lockUrl.toString(),
        tone: 'danger',
      },
      { kind: 'paragraph', text: t('email.security.lockLinkValidity'), tone: 'muted' },
    ],
    footerReason: `${t(`${base}.footer`, values)} ${t('email.security.cannotDisable')}`,
  })
  const message: MailMessage = {
    to: job.notifyEmail ?? user.email,
    subject: oneLine(t(`${base}.subject`, values)),
    text,
    html,
  }
  const result = await deps.mailer.send(message)
  if (result === 'not_configured') {
    // Expected until stage 3 configures email: the event is in the activity log anyway.
    deps.logger.info({ kind: job.kind }, 'security email not sent: not_configured')
  }
}

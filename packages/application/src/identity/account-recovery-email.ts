import type { AccountRecoveryEmailData } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { Mailer } from '../ports/mailer.js'
import type { Translate } from '../ports/translator.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import type { Clock } from '../ports/clock.js'
import {
  dayAndTime,
  emailFrame,
  isSameDay,
  oneLine,
  renderEmail,
  usableTimeZone,
} from '../mail/index.js'

export interface AccountRecoveryEmailDeps {
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
 * Job `identity.account_recovery_email`: after a reactivation with the identity checked on an
 * independent channel, the one-use link to choose a new password goes to the account's own
 * address, never to the operator. The link is never logged.
 */
export async function sendAccountRecoveryEmail(
  deps: AccountRecoveryEmailDeps,
  job: AccountRecoveryEmailData & { userId: string },
): Promise<void> {
  const user = await deps.uow.run({ userId: job.userId }, (tx) => tx.users.findById(job.userId))
  if (user === null || user.anonymizedAt !== null) {
    deps.logger.info({}, 'recovery email skipped: account gone')
    return
  }
  // queued inside the reactivation's transaction, which has not committed yet: pg-boss retries
  if (user.status !== 'active') throw new Error('account not active yet')
  const now = deps.clock.now()
  const expiresAt = new Date(job.expiresAt)
  const minutesLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / 60_000)
  if (!(minutesLeft > 0)) {
    deps.logger.info({}, 'recovery email skipped: link expired')
    return
  }
  const t = deps.translate
  const timeZone = usableTimeZone(user.timezone ?? deps.defaultTimezone, 'Europe/Rome')
  const { time } = dayAndTime(expiresAt, timeZone)
  const today = isSameDay(now, expiresAt, timeZone)
  const values = { product: deps.productName, minutes: String(minutesLeft), time }
  const { html, text } = renderEmail({
    ...emailFrame(t, deps.panelUrl, deps.productName),
    preheader: t('email.accountRecovery.preheader', values),
    title: t('email.accountRecovery.title', values),
    blocks: [
      { kind: 'paragraph', text: t('email.accountRecovery.intro', values) },
      { kind: 'button', label: t('email.accountRecovery.button'), url: job.url, tone: 'primary' },
      {
        kind: 'box',
        title: t('email.accountRecovery.expiryTitle', values),
        text: t(`email.accountRecovery.${today ? 'expiryToday' : 'expiryTomorrow'}`, values),
      },
      { kind: 'paragraph', text: t('email.accountRecovery.code') },
      { kind: 'paragraph', text: t('email.accountRecovery.secondFactor') },
      { kind: 'paragraph', text: t('email.accountRecovery.notMe') },
    ],
    footerReason: t('email.accountRecovery.footer', values),
  })
  const result = await deps.mailer.send({
    to: user.email,
    subject: oneLine(t('email.accountRecovery.subject', values)),
    text,
    html,
  })
  if (result === 'not_configured') deps.logger.info({}, 'recovery email not sent: not_configured')
}

import { displayName } from '@app/domain'
import type {
  AccountLockedNoticeData,
  AccountLockedNoticeEmailData,
  JobQueue,
} from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import { PLATFORM_SENDER } from '../ports/mailer.js'
import type { Mailer, MailMessage } from '../ports/mailer.js'
import type { UserRecord } from '../ports/repositories.js'
import type { Translate } from '../ports/translator.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { dayAndTime, emailFrame, oneLine, renderEmail, usableTimeZone } from '../mail/index.js'

export interface AccountLockedNoticeDeps {
  uow: UnitOfWork
  /** The notice fans out: one `identity.account_locked_notice_email` job per recipient. */
  queue: Pick<JobQueue, 'send'>
  mailer: Mailer
  translate: Translate
  logger: Logger
  panelUrl: URL
  productName: string
  /** Used when a recipient has not chosen a time zone. */
  defaultTimezone: string
}

const ROME = 'Europe/Rome'

interface Recipient {
  user: UserRecord
  /** Platform administrators also read the person's address; Owners read their agencies. */
  kind: 'admin' | 'owner'
  organizations: string[]
}

/**
 * Who hears about the lock: the active platform administrators, and the active Owners of the
 * active agencies where the person is an active member, the person excluded. An administrator who
 * is also an Owner gets one email, the administrator's. null: nothing to tell any more.
 */
async function findRecipients(
  deps: Pick<AccountLockedNoticeDeps, 'uow'>,
  job: AccountLockedNoticeData,
): Promise<{ locked: UserRecord; recipients: Recipient[] } | null> {
  const lockedAt = new Date(job.lockedAt)
  // A system job: the person's agencies and their Owners are rows of several agencies, which only
  // the system scope reads (this module is allowed to open it).
  return deps.uow.runAsSystem('platform: who hears about a security lock', async (tx) => {
    const locked = await tx.users.findById(job.lockedUserId)
    if (locked === null || locked.anonymizedAt !== null) return null
    // reactivated since: the administrators have already dealt with it
    if (locked.reactivatedAt !== null && locked.reactivatedAt.getTime() >= lockedAt.getTime())
      return null
    if (locked.securityLockedAt?.getTime() !== lockedAt.getTime()) {
      // queued inside the lock's transaction, which has not committed yet: pg-boss retries
      throw new Error('security lock not visible yet')
    }
    const recipients = new Map<string, Recipient>()
    for (const user of await tx.users.listActivePlatformAdmins())
      if (user.id !== locked.id) recipients.set(user.id, { user, kind: 'admin', organizations: [] })
    const memberships = (await tx.orgMembers.listForUser(locked.id)).filter(
      (m) => m.status === 'active' && m.organizationStatus === 'active',
    )
    for (const membership of memberships) {
      const owners = (await tx.orgMembers.listForOrganization(membership.organizationId)).filter(
        (m) => m.role === 'owner' && m.status === 'active' && m.userId !== locked.id,
      )
      for (const owner of owners) {
        const known = recipients.get(owner.userId)
        if (known) {
          known.organizations.push(membership.name)
          continue
        }
        const user = await tx.users.findById(owner.userId)
        if (user === null || user.status !== 'active' || user.anonymizedAt !== null) continue
        recipients.set(user.id, { user, kind: 'owner', organizations: [membership.name] })
      }
    }
    return { locked, recipients: [...recipients.values()] }
  })
}

function noticeFor(
  deps: Omit<AccountLockedNoticeDeps, 'queue'>,
  locked: UserRecord,
  lockedAt: Date,
  recipient: Recipient,
): MailMessage {
  const t = deps.translate
  const name = displayName(locked)
  const timeZone = usableTimeZone(recipient.user.timezone ?? deps.defaultTimezone, ROME)
  const at = t('email.date.dayAt', dayAndTime(lockedAt, timeZone, { year: true }))
  const when =
    timeZone === ROME
      ? t('email.security.whenRome', { at })
      : t('email.security.whenZone', { at, zone: timeZone })
  const values = { product: deps.productName, name }
  const forAdmin = recipient.kind === 'admin'
  const rows = [
    { label: t('email.lockNotice.labels.person'), value: name },
    ...(forAdmin ? [{ label: t('email.lockNotice.labels.email'), value: locked.email }] : []),
    ...(recipient.organizations.length > 0
      ? [
          {
            label: t('email.lockNotice.labels.organizations'),
            value: recipient.organizations.join(', '),
          },
        ]
      : []),
    { label: t('email.security.labels.when'), value: when },
  ]
  const role = forAdmin ? 'admin' : 'owner'
  const { html, text } = renderEmail({
    ...emailFrame(t, deps.panelUrl, deps.productName),
    preheader: t('email.lockNotice.preheader', values),
    title: t('email.lockNotice.title', values),
    blocks: [
      { kind: 'paragraph', text: t('email.lockNotice.intro', values) },
      { kind: 'details', rows },
      {
        kind: 'box',
        title: t('email.lockNotice.doneTitle'),
        text: t('email.lockNotice.doneText'),
      },
      {
        kind: 'lead',
        lead: t(`email.lockNotice.${role}.lead`),
        text: t(`email.lockNotice.${role}.text`, values),
      },
      { kind: 'paragraph', text: t('email.lockNotice.caution'), tone: 'muted' },
    ],
    footerReason: t(`email.lockNotice.${role}.footer`, values),
  })
  return {
    to: recipient.user.email,
    subject: oneLine(t('email.lockNotice.subject', values)),
    text,
    html,
  }
}

/**
 * Job `identity.account_locked_notice`: after "Non sono stato io", finds who can help and queues
 * one email job per recipient, keyed by lock and recipient: a retry of this job queues nobody
 * twice, and a failed email is retried alone. The activity log gets how many were told, never who.
 */
export async function sendAccountLockedNotice(
  deps: AccountLockedNoticeDeps,
  job: AccountLockedNoticeData,
): Promise<void> {
  const found = await findRecipients(deps, job)
  if (found === null) {
    deps.logger.info({}, 'security lock notice skipped: nothing to tell')
    return
  }
  let recipients = 0
  if (await deps.mailer.isConfigured(PLATFORM_SENDER.organizationId)) {
    for (const { user } of found.recipients) {
      await deps.queue.send(
        'identity.account_locked_notice_email',
        { lockedUserId: job.lockedUserId, lockedAt: job.lockedAt, recipientId: user.id },
        { dedupeKey: `${job.lockedUserId}:${job.lockedAt}:${user.id}` },
      )
      recipients += 1
    }
  } else if (found.recipients.length > 0) {
    deps.logger.info({}, 'security lock notice not sent: not_configured')
  }
  await deps.uow.runAsSystem('platform: record a security lock notice', (tx) =>
    tx.audit.record({
      organizationId: null,
      actorId: null,
      source: 'system',
      action: 'auth.security_lock_notified',
      entity: 'user',
      entityId: found.locked.id,
      workspaceId: null,
      ip: null,
      data: { recipients },
    }),
  )
}

/**
 * Job `identity.account_locked_notice_email`: the notice for one recipient, written for them
 * (administrator or Owner) at the moment it leaves. No action link and no token: the
 * reactivation happens from the command line. A mail failure fails this job only.
 */
export async function sendAccountLockedNoticeEmail(
  deps: Omit<AccountLockedNoticeDeps, 'queue'>,
  job: AccountLockedNoticeEmailData,
): Promise<void> {
  const found = await findRecipients(deps, job)
  const recipient = found?.recipients.find((r) => r.user.id === job.recipientId)
  if (!found || !recipient) {
    deps.logger.info({}, 'security lock notice skipped: recipient no longer concerned')
    return
  }
  const result = await deps.mailer.send(
    noticeFor(deps, found.locked, new Date(job.lockedAt), recipient),
    PLATFORM_SENDER,
  )
  if (result === 'not_configured')
    deps.logger.info({}, 'security lock notice not sent: not_configured')
}

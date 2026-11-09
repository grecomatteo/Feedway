import { displayName, RETENTION, retentionCutoffs } from '@app/domain'
import type { Auth } from '../ports/auth.js'
import type { Clock } from '../ports/clock.js'
import type { AnonymizationNoticeData, JobQueue } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { Mailer } from '../ports/mailer.js'
import type { Storage } from '../ports/storage.js'
import type { Translate } from '../ports/translator.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { dayAndTime, emailFrame, oneLine, renderEmail, usableTimeZone } from '../mail/index.js'
import { anonymizeUser } from './delete-account.js'
import { scheduledAnonymization } from './members.js'
import type { UserAnonymizedHandler } from './module.js'

export interface RetentionDeps {
  uow: UnitOfWork
  clock: Clock
  storage: Storage
  logger: Logger
  /** One `identity.anonymization_notice` job per Owner to tell. */
  queue: Pick<JobQueue, 'send'>
  auth: Pick<Auth, 'deleteAllCredentials'>
  onUserAnonymized: readonly UserAnonymizedHandler[]
}

/** What one run did: counts only, for the log. */
export interface RetentionReport {
  sessions: number
  devices: number
  auditIps: number
  verifications: number
  exportsExpired: number
  exportsFailed: number
  avatarPreviews: number
  noticesScheduled: number
  anonymized: number
  skipped: number
  /** Files or people that failed this time: logged, retried tomorrow; the rest goes on. */
  failed: number
}

/** Disabled this long, the Owners hear that the person will be anonymized (24 months − 30 days). */
const NOTICE_AFTER_MS = RETENTION.disabledUserMs - RETENTION.anonymizationNoticeMs

const ACTION_SCHEDULED = 'user.anonymization_scheduled'
const ACTION_SKIPPED = 'user.anonymization_skipped'

/**
 * The daily retention (spec §15.7), one step per transaction, each repeatable: running it twice
 * the same day changes nothing more. The system scope is needed: it reads everyone's rows.
 */
export async function runRetention(deps: RetentionDeps): Promise<RetentionReport> {
  const now = deps.clock.now()
  const cut = retentionCutoffs(now)
  const system = <T>(reason: string, fn: (tx: Tx) => Promise<T>) =>
    deps.uow.runAsSystem(`identity.retention: ${reason}`, fn)

  const sessions = await system('expired sessions', (tx) =>
    tx.sessions.deleteExpiredBefore(cut.expiredSessionsBefore),
  )
  const devices = await system('unused devices', (tx) =>
    tx.knownDevices.deleteUnusedBefore(cut.knownDevicesBefore),
  )
  const auditIps = await system('audit ips', (tx) => tx.audit.shortenIpsBefore(cut.auditIpBefore))
  const verifications = await system('expired verifications', (tx) =>
    tx.credentials.deleteExpiredVerifications(now),
  )

  // the file goes first: a row marked expired with its file still there would never be retried
  let failed = 0
  const tryEach = async (what: object, fn: () => Promise<void>): Promise<boolean> => {
    try {
      await fn()
      return true
    } catch (err) {
      deps.logger.error({ ...what, err }, 'retention step failed')
      failed += 1
      return false
    }
  }

  let exportsExpired = 0
  for (const record of await system('expired exports', (tx) =>
    tx.dataExports.listExpiredReady(now),
  ))
    if (
      await tryEach({ exportId: record.id }, async () => {
        if (record.storageKey !== null) await deps.storage.delete(record.storageKey)
        await system('expired export', (tx) =>
          tx.dataExports.update(record.userId, record.id, { status: 'expired', at: now }),
        )
      })
    )
      exportsExpired += 1
  const exportsFailed = await system('stuck exports', (tx) =>
    tx.dataExports.failStuck(cut.dataExportBefore, now),
  )

  let avatarPreviews = 0
  for (const file of await deps.storage.list('users/'))
    if (
      file.key.includes('/avatar/staging/') &&
      file.modifiedAt < cut.avatarStagingBefore &&
      (await tryEach({}, () => deps.storage.delete(file.key)))
    )
      avatarPreviews += 1

  const people = await disabledPeople(deps, now, tryEach)
  const report: RetentionReport = {
    sessions,
    devices,
    auditIps,
    verifications,
    exportsExpired,
    exportsFailed,
    avatarPreviews,
    ...people,
    failed,
  }
  deps.logger.info({ report }, 'retention done')
  return report
}

/**
 * Step 7: people disabled by the platform. Never an Owner or the platform administrator; a
 * notice counts only if recorded after the last disable; anonymized after 24 months and at least
 * 30 days after a valid notice.
 */
async function disabledPeople(
  deps: RetentionDeps,
  now: Date,
  tryEach: (what: object, fn: () => Promise<void>) => Promise<boolean>,
): Promise<Pick<RetentionReport, 'noticesScheduled' | 'anonymized' | 'skipped'>> {
  const system = <T>(reason: string, fn: (tx: Tx) => Promise<T>) =>
    deps.uow.runAsSystem(`identity.retention: ${reason}`, fn)
  const noticeBefore = new Date(now.getTime() - NOTICE_AFTER_MS)
  const result = { noticesScheduled: 0, anonymized: 0, skipped: 0 }

  for (const user of await system('disabled accounts', (tx) =>
    tx.users.listDisabledBefore(noticeBefore),
  ))
    // one person failing never holds back the others
    await tryEach({ userId: user.id }, async () => {
      const disabledAt = user.disabledAt
      if (disabledAt === null) return
      const decision = await system('one disabled account', (tx) =>
        decide(deps, tx, user.id, disabledAt, now),
      )
      if (decision.kind === 'skipped') result.skipped += 1
      if (decision.kind === 'noticed') {
        // sent once the entries are committed; the dedupe key makes a resend harmless
        for (const job of decision.jobs)
          await deps.queue.send('identity.anonymization_notice', job.data, {
            dedupeKey: job.dedupeKey,
          })
        result.noticesScheduled += 1
      }
      if (decision.kind !== 'due') return
      const done = await anonymizeUser(deps, {
        userId: user.id,
        source: 'system',
        disabledSince: disabledAt,
      })
      if (!done) return
      await system('record an anonymization', async (tx) => {
        const entry = {
          organizationId: null,
          action: 'user.anonymized',
          entityId: user.id,
        } as const
        if (!(await tx.audit.exists({ ...entry, source: 'system' })))
          await platformEntry(tx, 'user.anonymized', user.id, {})
      })
      result.anonymized += 1
    })
  return result
}

interface NoticeJob {
  data: AnonymizationNoticeData & { userId: string }
  dedupeKey: string
}

type Decision =
  { kind: 'gone' | 'skipped' | 'waiting' | 'due' } | { kind: 'noticed'; jobs: NoticeJob[] }

/** Under the account's row lock: what to do with this disabled period. */
async function decide(
  deps: RetentionDeps,
  tx: Tx,
  userId: string,
  disabledAt: Date,
  now: Date,
): Promise<Decision> {
  // read again under the row lock: reactivated or anonymized since the list
  const current = await tx.users.findByIdForUpdate(userId)
  if (current?.status !== 'disabled' || current.anonymizedAt !== null) return { kind: 'gone' }
  if (current.disabledAt?.getTime() !== disabledAt.getTime()) return { kind: 'gone' }
  const memberships = await tx.orgMembers.listForUser(userId)
  const reason =
    current.platformRole === 'admin'
      ? 'platform_admin'
      : memberships.some((m) => m.role === 'owner')
        ? 'owner'
        : null
  const period = disabledAt.toISOString()
  if (reason !== null) {
    deps.logger.warn({ userId, reason }, 'anonymization skipped')
    if ((await forPeriod(tx, ACTION_SKIPPED, userId, period)) === null)
      await platformEntry(tx, ACTION_SKIPPED, userId, { reason, disabledAt: period })
    return { kind: 'skipped' }
  }
  const notice = await forPeriod(tx, ACTION_SCHEDULED, userId, period)
  if (notice === null) {
    const scheduledFor = new Date(
      Math.max(
        disabledAt.getTime() + RETENTION.disabledUserMs,
        now.getTime() + RETENTION.anonymizationNoticeMs,
      ),
    )
    return {
      kind: 'noticed',
      jobs: await recordNotice(tx, userId, period, memberships, scheduledFor),
    }
  }
  // the date told to the Owners: 24 months disabled and 30 days after the notice
  const scheduledFor = typeof notice.scheduledFor === 'string' ? notice.scheduledFor : null
  if (scheduledFor === null) return { kind: 'waiting' }
  return { kind: new Date(scheduledFor) <= now ? 'due' : 'waiting' }
}

/**
 * The data of the newest platform entry like this, if it belongs to the current disabled period:
 * a notice or a skip given before a reactivation does not count. Compared on the recorded
 * period, never on when the row was written (the database's clock).
 */
async function forPeriod(
  tx: Tx,
  action: typeof ACTION_SCHEDULED | typeof ACTION_SKIPPED,
  userId: string,
  period: string,
): Promise<Record<string, unknown> | null> {
  const entry = await tx.audit.latest({ organizationId: null, action, entityId: userId })
  return entry?.data.disabledAt === period ? entry.data : null
}

function platformEntry(
  tx: Tx,
  action: 'user.anonymized' | typeof ACTION_SCHEDULED | typeof ACTION_SKIPPED,
  userId: string,
  data: Record<string, unknown>,
) {
  return tx.audit.record({
    organizationId: null,
    actorId: null,
    source: 'system',
    action,
    entity: 'user',
    entityId: userId,
    workspaceId: null,
    ip: null,
    data,
  })
}

/**
 * The platform's own entry decides when the notice was given; each agency the person was in gets
 * one too, and its active Owners an email: the jobs to send, one per Owner and period.
 */
async function recordNotice(
  tx: Tx,
  userId: string,
  period: string,
  memberships: Awaited<ReturnType<Tx['orgMembers']['listForUser']>>,
  scheduledFor: Date,
): Promise<NoticeJob[]> {
  const data = { scheduledFor: scheduledFor.toISOString(), disabledAt: period }
  await platformEntry(tx, ACTION_SCHEDULED, userId, data)
  const jobs: NoticeJob[] = []
  for (const m of memberships) {
    await tx.audit.record({
      organizationId: m.organizationId,
      actorId: null,
      source: 'system',
      action: ACTION_SCHEDULED,
      entity: 'user',
      entityId: userId,
      workspaceId: null,
      ip: null,
      data,
    })
    const owners = (await tx.orgMembers.listForOrganization(m.organizationId)).filter(
      (o) => o.role === 'owner' && o.status === 'active',
    )
    for (const owner of owners)
      jobs.push({
        data: {
          userId: owner.userId,
          subjectId: userId,
          organizationId: m.organizationId,
          scheduledFor: data.scheduledFor,
        },
        dedupeKey: `${userId}:${period}:${m.organizationId}:${owner.userId}`,
      })
  }
  return jobs
}

export interface AnonymizationNoticeDeps {
  uow: UnitOfWork
  mailer: Mailer
  translate: Translate
  logger: Logger
  panelUrl: URL
  productName: string
  /** Used when the Owner has not chosen a time zone. */
  defaultTimezone: string
}

/**
 * Job `identity.anonymization_notice`: tells one Owner, in their agency's scope, that a person
 * of the agency disabled by the platform will be anonymized. Nothing is sent when it no longer
 * holds (the person was reactivated or is gone, the recipient is no longer the Owner).
 */
export async function sendAnonymizationNotice(
  deps: AnonymizationNoticeDeps,
  job: AnonymizationNoticeData & { userId: string },
): Promise<void> {
  const { organizationId, userId } = job
  const found = await deps.uow.run({ organizationId, userId }, async (tx) => {
    const me = await tx.orgMembers.find(organizationId, userId)
    if (me?.role !== 'owner' || me.status !== 'active') return null
    const owner = await tx.users.findById(userId)
    if (owner?.status !== 'active' || owner.anonymizedAt !== null) return null
    if ((await tx.orgMembers.find(organizationId, job.subjectId)) === null) return null
    const subject = await tx.users.findById(job.subjectId)
    if (subject?.status !== 'disabled' || subject.anonymizedAt !== null) return null
    // a job left from an earlier disabled period is not sent: the next run gives the new date
    const scheduledFor = await scheduledAnonymization(tx, organizationId, subject)
    if (scheduledFor !== job.scheduledFor) return null
    const agency = await tx.organizations.findById(organizationId)
    return agency ? { owner, subject, agency: agency.name } : null
  })
  if (found === null) {
    deps.logger.info({}, 'anonymization notice skipped: no longer concerned')
    return
  }
  const t = deps.translate
  const timeZone = usableTimeZone(found.owner.timezone ?? deps.defaultTimezone, 'Europe/Rome')
  const values = {
    product: deps.productName,
    name: displayName(found.subject),
    agency: found.agency,
    date: dayAndTime(new Date(job.scheduledFor), timeZone, { year: true }).day,
  }
  const { html, text } = renderEmail({
    ...emailFrame(t, deps.productName),
    preheader: t('email.anonymizationNotice.preheader', values),
    title: t('email.anonymizationNotice.title', values),
    blocks: [
      { kind: 'paragraph', text: t('email.anonymizationNotice.intro', values) },
      {
        kind: 'lead',
        lead: t('email.anonymizationNotice.what.lead'),
        text: t('email.anonymizationNotice.what.text', values),
      },
      {
        kind: 'lead',
        lead: t('email.anonymizationNotice.keep.lead'),
        text: t('email.anonymizationNotice.keep.text', values),
      },
    ],
    footerReason: t('email.anonymizationNotice.footer', values),
  })
  const result = await deps.mailer.send({
    to: found.owner.email,
    subject: oneLine(t('email.anonymizationNotice.subject', values)),
    text,
    html,
  })
  if (result === 'not_configured')
    deps.logger.info({}, 'anonymization notice not sent: not_configured')
}

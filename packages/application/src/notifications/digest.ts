import { DIGEST_CATCH_UP_MS, storedTimeZone } from '@app/domain'
import { isUuid } from '../identity/index.js'
import { dayAndTime, usableTimeZone } from '../mail/index.js'
import type { DigestBlock, DigestReminderSources, DigestSection } from '../module-definition.js'
import type { Clock } from '../ports/clock.js'
import type { Logger } from '../ports/logger.js'
import type { NotificationChannel, RenderedMessage } from '../ports/notification-channel.js'
import type { UserRecord } from '../ports/repositories.js'
import type { Translate } from '../ports/translator.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { recipientOf } from './deliver.js'
import { panelLink } from './message.js'
import { eligibleUser } from './recipients.js'

// `report.digest` (§12.4, plan 08 Task 8): one person's morning digest. The job has the scope of
// the person: it reads the person's agencies, then computes each section inside
// `uow.run({ organizationId, userId })` of that agency, so a section sees only what the person
// sees there. One message per agency and channel (D-121 punto 13): each agency may have its own
// Telegram bot, and a suspended one is left out. A digest with nothing to say is not sent.

export interface DigestDeps {
  uow: UnitOfWork
  clock: Clock
  logger: Logger
  t: Translate
  panelUrl: URL
  defaultTimezone: string
  sections: readonly DigestSection[]
  channels: readonly NotificationChannel[]
  metaReminders: DigestReminderSources
}

export interface DigestJob {
  userId: string
  date: string
  dueAt: string
}

export type DigestReport =
  | { outcome: 'skipped'; reason: 'late' | 'off' | 'gone' }
  | {
      outcome: 'done'
      agencies: number
      /** messages a channel took */
      sent: number
      /** messages a channel refused; written in the log, not tried again */
      failed: number
      /** sections that threw; the others went out */
      sectionErrors: number
    }

/** A job a day late or more found its person's morning gone: it sends nothing. */
const LATE_MS = DIGEST_CATCH_UP_MS + 2 * 3_600_000

export function assertDigestJob(job: Partial<DigestJob>): asserts job is DigestJob {
  if (typeof job.userId !== 'string' || !isUuid(job.userId))
    throw new Error('report.digest without userId')
  if (typeof job.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(job.date))
    throw new Error('report.digest without date')
  if (typeof job.dueAt !== 'string' || Number.isNaN(new Date(job.dueAt).getTime()))
    throw new Error('report.digest without dueAt')
}

interface Agency {
  organizationId: string
  name: string
  slug: string
  timeZone: string
}

/** The person and the agencies they still work for, in the person's own scope. */
async function personOf(deps: DigestDeps, userId: string) {
  return deps.uow.run({ userId }, async (tx) => {
    const user = await tx.users.findById(userId)
    if (user?.status !== 'active' || user.anonymizedAt !== null) return null
    const settings = await tx.notificationPrefs.getSettings(userId)
    const memberships = (await tx.orgMembers.listForUser(userId)).filter(
      (m) => m.status === 'active' && m.organizationStatus === 'active',
    )
    return { user, settings, memberships }
  })
}

/** The agency as it is now, if the person still works for it. */
async function agencyOf(
  deps: DigestDeps,
  userId: string,
  organizationId: string,
): Promise<{ agency: Agency; user: UserRecord } | null> {
  return deps.uow.run({ organizationId, userId }, async (tx) => {
    const organization = await tx.organizations.findById(organizationId)
    if (organization?.status !== 'active') return null
    const user = await eligibleUser(
      tx,
      userId,
      { organizationId, workspaceId: null, accountId: null },
      [],
    )
    if (!user) return null
    return {
      user,
      agency: {
        organizationId,
        name: organization.name,
        slug: organization.slug,
        timeZone: storedTimeZone(organization.settings),
      },
    }
  })
}

/** Each section in its own transaction: one that throws leaves the others whole. */
async function blocksOf(
  deps: DigestDeps,
  userId: string,
  agency: Agency,
  now: Date,
): Promise<{ blocks: DigestBlock[]; errors: number }> {
  const blocks: DigestBlock[] = []
  let errors = 0
  for (const section of deps.sections) {
    try {
      const block = await deps.uow.run({ organizationId: agency.organizationId, userId }, (tx) =>
        section.build(tx, {
          organizationId: agency.organizationId,
          userId,
          now,
          timeZone: agency.timeZone,
          t: deps.t,
          panelUrl: deps.panelUrl,
          metaReminders: deps.metaReminders,
        }),
      )
      if (block && block.lines.length > 0) blocks.push(block)
    } catch (error) {
      errors++
      deps.logger.error(
        { err: error, section: section.id, organizationId: agency.organizationId, userId },
        'digest section failed',
      )
    }
  }
  return { blocks, errors }
}

function digestMessage(
  deps: DigestDeps,
  agency: Agency,
  blocks: readonly DigestBlock[],
  now: Date,
  timeZone: string,
): RenderedMessage {
  const { day } = dayAndTime(now, timeZone)
  return {
    level: 'info',
    title: deps.t('digest.title', { day }),
    context: agency.name,
    lines: [],
    more: 0,
    link: {
      label: deps.t('digest.open'),
      url: panelLink({ panelUrl: deps.panelUrl }, agency.slug),
    },
    sections: blocks.map((b) => ({ title: b.title, lines: b.lines, more: b.more })),
  }
}

/** Job `report.digest`: one person's digest, in the person's scopes. */
export async function sendDigest(
  deps: DigestDeps,
  job: Partial<DigestJob>,
  signal: AbortSignal = new AbortController().signal,
): Promise<DigestReport> {
  assertDigestJob(job)
  const now = deps.clock.now()
  if (now.getTime() - new Date(job.dueAt).getTime() > LATE_MS)
    return { outcome: 'skipped', reason: 'late' }
  const person = await personOf(deps, job.userId)
  if (!person) return { outcome: 'skipped', reason: 'gone' }
  // turned off after the job was sent
  if (!person.settings.digest.enabled) return { outcome: 'skipped', reason: 'off' }
  const report = { outcome: 'done' as const, agencies: 0, sent: 0, failed: 0, sectionErrors: 0 }
  for (const membership of person.memberships) {
    const found = await agencyOf(deps, job.userId, membership.organizationId)
    if (!found) continue
    const { agency, user } = found
    const { blocks, errors } = await blocksOf(deps, job.userId, agency, now)
    report.sectionErrors += errors
    if (blocks.length === 0) continue
    report.agencies++
    const timeZone = usableTimeZone(user.timezone, agency.timeZone)
    const message = digestMessage(deps, agency, blocks, now, timeZone)
    const recipient = recipientOf(user, agency.organizationId)
    for (const channel of deps.channels) {
      const available = await deps.uow.run(
        { organizationId: agency.organizationId, userId: job.userId },
        (tx) => channel.isAvailable(tx, recipient),
      )
      if (!available) continue
      // outside any transaction, as every send (plan 08 «Ogni invio in transazione corta»)
      let ok = false
      try {
        ok = (await channel.send(recipient, message, signal)).outcome === 'sent'
      } catch (error) {
        deps.logger.error(
          { error: error instanceof Error ? error.name : typeof error, channel: channel.name },
          'digest channel threw',
        )
      }
      if (ok) report.sent++
      else {
        // not tried again: the job would send the other agencies and channels twice, and the
        // next morning brings a new digest (D-121 punto 13)
        report.failed++
        deps.logger.warn(
          { channel: channel.name, organizationId: agency.organizationId, userId: job.userId },
          'digest not sent',
        )
      }
    }
  }
  return report
}

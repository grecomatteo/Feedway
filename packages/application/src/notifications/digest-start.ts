import { DEFAULT_DIGEST, digestTimeZone, dueDigest, storedTimeZone } from '@app/domain'
import { usableTimeZone } from '../mail/index.js'
import type { Clock } from '../ports/clock.js'
import type { JobQueue } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { ExclusiveLock } from '../ports/media-processing.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

// `report.daily` (plan 08 P7): a system job every minute that only starts the digests (§12.4).
// It reads every person across the agencies (listed in the ESLint rule on `runAsSystem`) and
// sends a `report.digest` to each one whose digest is due now; each digest is then computed in
// its person's scopes. The key `<userId>:<date>` sends it once per day, whatever the restarts.

export interface DigestStartDeps {
  uow: UnitOfWork
  clock: Clock
  logger: Logger
  queue: Pick<JobQueue, 'send'>
  /** The installation's lock (ADR 021): with more workers, one run at a time */
  lock: ExclusiveLock
  /** TZ_DEFAULT: the zone of a person with no zone and no agency's */
  defaultTimezone: string
}

export interface DigestStartReport {
  /** false: another worker holds the run */
  ran: boolean
  due: number
  /** jobs pg-boss took: the others were already sent this day */
  sent: number
}

export const DIGEST_LOCK = 'report.daily'

export async function startDigests(deps: DigestStartDeps): Promise<DigestStartReport> {
  const run = await deps.lock.tryRun(DIGEST_LOCK, async () => {
    const now = deps.clock.now()
    const { people, schedules } = await deps.uow.runAsSystem(
      'report.daily: who has the digest due',
      async (tx) => {
        const members = await tx.users.listActiveMembersWithZones()
        const chosen = await tx.notificationPrefs.listDigestSchedules(members.map((m) => m.userId))
        return { people: members, schedules: chosen }
      },
      { routine: true },
    )
    let due = 0
    let sent = 0
    for (const person of people) {
      // one person's odd data or a refused send does not stop the others; the next minute retries
      try {
        const timeZone = usableTimeZone(
          digestTimeZone(
            person.timeZone,
            person.agencyTimeZones.map((timezone) => storedTimeZone({ timezone })),
            deps.defaultTimezone,
          ),
          deps.defaultTimezone,
        )
        const digest = dueDigest(schedules.get(person.userId) ?? DEFAULT_DIGEST, now, timeZone)
        if (!digest) continue
        due++
        const id = await deps.queue.send(
          'report.digest',
          { userId: person.userId, date: digest.date, dueAt: digest.at.toISOString() },
          { dedupeKey: `${person.userId}:${digest.date}` },
        )
        if (id !== null) sent++
      } catch (error) {
        deps.logger.error(
          { error: error instanceof Error ? error.name : typeof error, userId: person.userId },
          'report.daily could not start a digest',
        )
      }
    }
    return { due, sent }
  })
  return run.acquired ? { ran: true, ...run.value } : { ran: false, due: 0, sent: 0 }
}

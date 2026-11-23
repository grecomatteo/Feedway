import { digestTimeZone, dueDigest, storedTimeZone } from '@app/domain'
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
    const candidates = await deps.uow.runAsSystem('report.daily: who has the digest due', (tx) =>
      tx.notificationPrefs.listDigestCandidates(),
    )
    let due = 0
    let sent = 0
    for (const person of candidates) {
      const timeZone = usableTimeZone(
        digestTimeZone(
          person.timeZone,
          person.agencyTimeZones.map((timezone) => storedTimeZone({ timezone })),
          deps.defaultTimezone,
        ),
        deps.defaultTimezone,
      )
      const digest = dueDigest(person.digest, now, timeZone)
      if (!digest) continue
      due++
      try {
        const id = await deps.queue.send(
          'report.digest',
          { userId: person.userId, date: digest.date, dueAt: digest.at.toISOString() },
          { dedupeKey: `${person.userId}:${digest.date}` },
        )
        if (id !== null) sent++
      } catch (error) {
        // one refused send does not stop the others; the next minute sends it again
        deps.logger.error(
          { err: error, userId: person.userId },
          'report.daily could not send a digest job',
        )
      }
    }
    return { due, sent }
  })
  return run.acquired ? { ran: true, ...run.value } : { ran: false, due: 0, sent: 0 }
}

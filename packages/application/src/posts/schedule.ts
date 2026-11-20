import {
  DomainError,
  checkLimit,
  distinctCopies,
  prepareAt,
  recheckAt,
  instantToZoned,
  parseLimits,
  storedTimeZone,
  zonedToInstant,
  type OrgActor,
  type RuleReport,
} from '@app/domain'
import type { PostRecord, PostScope } from '../ports/posts.js'
import type { Tx } from '../ports/tx.js'
import { requestPublishCopies } from '../media/index.js'
import { checkPostInTx, publishFilesOfPost } from '../rules/index.js'
import { sendSteps, type StepJob } from './publishing/context.js'
import type { assertActiveOrganization } from '../workspaces/index.js'
import {
  cannotChangeScheduled,
  cannotSchedule,
  changeOf,
  isScheduledForPanel,
  lockedPost,
  mayPublish,
  openPosts,
  postNotFound,
  recordPost,
  versionConflict,
  writeParts,
  wrongState,
  type PostContent,
  type PostsDeps,
} from './common.js'
import { readPost, type PostDto } from './read.js'
import { noDate, toCheckInput } from './to-check-input.js'

// Scheduling (spec §11.2 point 8, §11.9; plan 06 Task 4). The checks run again on the saved
// post, inside the transaction that writes it: the panel is not the only defence. Scheduling,
// back to draft and cancelling take `post.publish`, which the Publisher holds on every post of
// the workspace; `scheduled_by` says who did it.

type Organization = Awaited<ReturnType<typeof assertActiveOrganization>>

/** 422 with the checks of the saved post: the editor shows what to fix. */
export const notSchedulable = (report: RuleReport) =>
  new DomainError('VALIDATION', 'Il post ha dei problemi da risolvere prima di programmarlo', {
    reason: 'post_not_schedulable',
    report,
  })

const nextDay = (localDate: string) => {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/** The agency's day of the instant, in the agency's time zone: the limit is the agency's. */
function agencyDay(at: Date, timeZone: string) {
  const { localDate } = instantToZoned(at, timeZone)
  return {
    localDate,
    from: zonedToInstant(localDate, '00:00', timeZone).instant,
    to: zonedToInstant(nextDay(localDate), '00:00', timeZone).instant,
  }
}

/** `posts_per_day`: the scheduled posts of the agency on that day, this one left out. */
async function assertDailyLimit(tx: Tx, organization: Organization, post: PostRecord, at: Date) {
  const limits = parseLimits(organization.limits)
  if (limits.posts_per_day === undefined) return
  const day = agencyDay(at, storedTimeZone(organization.settings))
  const count = await tx.posts.countScheduled(organization.id, day, post.id)
  const check = checkLimit(limits, 'posts_per_day', count)
  if (!check.ok)
    throw new DomainError(
      'LIMIT_REACHED',
      `L’agenzia ha già ${String(check.limit)} post programmati in quel giorno: è il massimo`,
      { limit: check.limit },
    )
}

/**
 * What a change of the schedule sends after its commit (plan 07 P3): the first step of each
 * destination, and the worker's wake-up when copies are waiting to be made.
 */
export interface AfterSchedule {
  steps: StepJob[]
  copiesFor: string | null
}

export const NOTHING_AFTER: AfterSchedule = { steps: [], copiesFor: null }

/** Sends what the change asked for; a send that fails is sent again by the reconciler. */
export async function sendAfterSchedule(
  deps: Pick<PostsDeps, 'queue' | 'logger'>,
  organizationId: string,
  after: AfterSchedule,
): Promise<void> {
  await sendSteps(deps, after.steps)
  if (after.copiesFor !== null)
    await deps.queue
      .send('media.publish_copies', { organizationId, postId: after.copiesFor })
      .catch((error: unknown) => {
        deps.logger.error({ err: error }, 'publish copies wake-up not queued')
      })
}

/**
 * The checks of the saved post (`purpose: 'save'`), then its destinations as scheduled: each
 * with the fingerprint of what it publishes (P3) and the time of its preparation (`prepareAt`);
 * a destination a choice leaves out (another platform skipped) is cancelled, it never goes out.
 * The copies its files need are asked for now, hours before (Scelta 4).
 */
async function scheduleSaved(
  tx: Tx,
  deps: PostsDeps,
  actor: OrgActor,
  organization: Organization,
  scope: PostScope,
  postId: string,
  previousAt: Date | null,
): Promise<AfterSchedule> {
  const saved = await tx.posts.find(scope, postId)
  if (!saved) throw postNotFound()
  const report = await checkPostInTx(tx, deps, actor, toCheckInput(saved, 'save'))
  if (!report.canSchedule) throw notSchedulable(report)
  const at = saved.scheduledAt
  if (at === null) throw noDate()
  const timeZone = storedTimeZone(organization.settings)
  if (
    previousAt === null ||
    agencyDay(previousAt, timeZone).localDate !== agencyDay(at, timeZone).localDate
  )
    await assertDailyLimit(tx, organization, saved, at)
  const going = new Map(report.destinations.map((d) => [d.accountId, d.fingerprint]))
  const now = deps.clock.now()
  const startAt = prepareAt(at, now)
  // checked again 3 hours before, or at once when fewer are left (Scelta 4)
  const checkAt = recheckAt(at, now)
  await tx.posts.replaceTargets(
    scope,
    saved.id,
    saved.targets.map((t) =>
      going.has(t.accountId)
        ? {
            accountId: t.accountId,
            status: 'scheduled',
            fingerprint: going.get(t.accountId) ?? null,
            nextAttemptAt: startAt,
            recheckAt: checkAt,
          }
        : { accountId: t.accountId, status: 'cancelled', fingerprint: null },
    ),
  )
  const files = await publishFilesOfPost(tx, deps, scope, toCheckInput(saved, 'publish'), report)
  const asked = await requestPublishCopies(
    tx,
    { ids: deps.ids, newPublicToken: deps.newPublicToken },
    scope,
    distinctCopies(files),
  )
  const steps = (await tx.publishing.targetsOfPost(scope.organizationId, saved.id))
    .filter((t) => t.status === 'scheduled')
    .map((t): StepJob => ({
      name: 'target.prepare',
      organizationId: scope.organizationId,
      targetId: t.id,
      generation: t.generation,
      startAfter: startAt,
    }))
  return { steps, copiesFor: asked > 0 ? saved.id : null }
}

/** «Programma»: a draft with a date, whose checks pass. */
export async function schedulePost(
  deps: PostsDeps,
  actor: OrgActor,
  input: { workspaceId: string; postId: string; version: number },
  request: { ip: string | null },
): Promise<PostDto> {
  const { dto, after } = await deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope, organization } = await openPosts(tx, actor, input.workspaceId, {
        write: true,
      })
      if (!organization) throw postNotFound()
      const post = await lockedPost(tx, scope, input.postId)
      if (!mayPublish(current, post)) throw cannotSchedule()
      if (post.version !== input.version) throw versionConflict()
      if (post.status !== 'draft') throw wrongState(post.status, 'schedule')
      if (post.scheduledAt === null) throw noDate()
      // one at a time in the agency: the posts of a day, and a file deleted meanwhile
      await tx.posts.lockSchedule(scope.organizationId)
      const version = await tx.posts.update(
        scope,
        post.id,
        {
          type: post.type,
          caption: post.caption,
          captionByPlatform: post.captionByPlatform,
          scheduledAt: post.scheduledAt,
          status: 'scheduled',
          options: post.options,
          scheduledBy: current.userId,
          updatedBy: current.userId,
        },
        post.version,
      )
      if (version === null) throw versionConflict()
      const after = await scheduleSaved(tx, deps, current, organization, scope, post.id, null)
      await recordPost(tx, current, 'post.scheduled', post, request.ip)
      return { dto: await readPost(tx, current, scope, post.id), after }
    },
  )
  await sendAfterSchedule(deps, actor.organizationId, after)
  return dto
}

/**
 * «Salva modifiche» of a scheduled post: the same checks as «Programma», and it stays
 * scheduled. Changing its content takes both the content's permission and `post.publish`: an
 * Editor only saves drafts (§11.2).
 */
export async function saveScheduled(
  tx: Tx,
  deps: PostsDeps,
  actor: OrgActor,
  organization: Organization,
  post: PostRecord,
  content: PostContent,
): Promise<AfterSchedule> {
  if (!mayPublish(actor, post)) throw cannotChangeScheduled()
  if (content.when === null)
    throw new DomainError('VALIDATION', 'Un post programmato ha bisogno di giorno e ora', {
      field: 'when',
    })
  const scope = { organizationId: post.organizationId, workspaceId: post.workspaceId }
  await tx.posts.lockSchedule(scope.organizationId)
  const version = await tx.posts.update(
    scope,
    post.id,
    changeOf(post, content, actor.userId, 'scheduled'),
    post.version,
  )
  if (version === null) throw versionConflict()
  await writeParts(tx, scope, post.id, content, 'scheduled')
  return scheduleSaved(tx, deps, actor, organization, scope, post.id, post.scheduledAt)
}

/** The destinations of the post, all in one state, without fingerprints. */
async function moveTargets(
  tx: Tx,
  scope: PostScope,
  post: PostRecord,
  status: 'draft' | 'cancelled',
) {
  await tx.posts.replaceTargets(
    scope,
    post.id,
    post.targets.map((t) => ({ accountId: t.accountId, status, fingerprint: null })),
  )
}

/** A scheduled post, moved by someone with `post.publish` to the state asked (P7). */
async function moveScheduled(
  deps: Pick<PostsDeps, 'uow'>,
  actor: OrgActor,
  input: { workspaceId: string; postId: string; version: number },
  to: 'draft' | 'cancelled',
  ip: string | null,
): Promise<PostDto> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope } = await openPosts(tx, actor, input.workspaceId, { write: true })
      const post = await lockedPost(tx, scope, input.postId)
      if (!mayPublish(current, post)) throw cannotChangeScheduled()
      if (post.version !== input.version) throw versionConflict()
      // P2: also during the preparation, until a destination is being published
      if (!(await isScheduledForPanel(tx, post)))
        throw wrongState(post.status, to === 'draft' ? 'unschedule' : 'cancel')
      const version = await tx.posts.update(
        scope,
        post.id,
        {
          type: post.type,
          caption: post.caption,
          captionByPlatform: post.captionByPlatform,
          scheduledAt: post.scheduledAt,
          status: to,
          options: post.options,
          scheduledBy: post.scheduledBy,
          updatedBy: current.userId,
        },
        post.version,
      )
      if (version === null) throw versionConflict()
      await moveTargets(tx, scope, post, to)
      await recordPost(
        tx,
        current,
        to === 'draft' ? 'post.unscheduled' : 'post.cancelled',
        post,
        ip,
      )
      return readPost(tx, current, scope, post.id)
    },
  )
}

/** «Riporta in bozza»: the post leaves the schedule and keeps everything (P7). */
export const unschedulePost = (
  deps: Pick<PostsDeps, 'uow'>,
  actor: OrgActor,
  input: { workspaceId: string; postId: string; version: number },
  request: { ip: string | null },
) => moveScheduled(deps, actor, input, 'draft', request.ip)

/** «Annulla»: the post goes out on no account; it can then be deleted. */
export const cancelPost = (
  deps: Pick<PostsDeps, 'uow'>,
  actor: OrgActor,
  input: { workspaceId: string; postId: string; version: number },
  request: { ip: string | null },
) => moveScheduled(deps, actor, input, 'cancelled', request.ip)

import {
  DISCARD_KEY,
  DomainError,
  can,
  canMoveTarget,
  prepareAt,
  recheckAt,
  roundIds,
  type OrgActor,
  type TargetStatus,
} from '@app/domain'
import { isUuid } from '../../identity/index.js'
import type { PostRecord, PostScope } from '../../ports/posts.js'
import type { PublishingTargetRecord, TargetStepPatch } from '../../ports/publishing.js'
import type { Tx } from '../../ports/tx.js'
import {
  lockedPost,
  openPosts,
  scheduledAtOf,
  versionConflict,
  type PostWhenInput,
  type PostsDeps,
} from '../common.js'
import { readPost, type PostDto } from '../read.js'
import { confirmTarget, sendSteps, type StepJob } from './context.js'
import { retryMark } from './retry-mark.js'

// What a person does on a destination after the worker (plan 07 Task 8, §9.3, §10.2): «Riprova»,
// «Segna come verificato», «Annulla» of one destination, and «Riprendi» or «Annulla» of a post in
// pause. Each locks the post, then the destination, as the worker's steps do; the jobs leave
// after the commit (P3). A destination is named by its account: one per account in a post.

type Input = { workspaceId: string; postId: string; accountId: string }

const resourceOf = (post: PostRecord) => ({
  organizationId: post.organizationId,
  workspaceId: post.workspaceId,
  ownerId: post.createdBy,
})

/**
 * §10.2 «Riprovare pubblicazioni fallite» (P6): the Manager and above on every post, the
 * Publisher on the posts they created.
 */
const mayRetry = (actor: OrgActor, post: PostRecord) =>
  can(actor, 'post.manage_others', resourceOf(post)) ||
  (can(actor, 'post.publish', resourceOf(post)) && post.createdBy === actor.userId)

/** P5: a post in pause is resumed or cancelled by whoever manages the posts of others. */
const mayManage = (actor: OrgActor, post: PostRecord) =>
  can(actor, 'post.manage_others', resourceOf(post))

const mayCancel = (actor: OrgActor, post: PostRecord) =>
  can(actor, 'post.publish', resourceOf(post))

const forbidden = () =>
  new DomainError('FORBIDDEN', 'Non puoi farlo su questo post: chiedi a chi gestisce il cliente')

const destinationNotFound = () =>
  new DomainError('NOT_FOUND', 'Questo account non è tra le destinazioni del post')

const wrongTargetState = (message: string) =>
  new DomainError('CONFLICT', message, { reason: 'target_wrong_state' })

/** The destination of the post on that account, locked; «non trovato» for anything else. */
async function lockedTarget(
  tx: Tx,
  post: PostRecord,
  accountId: string,
): Promise<PublishingTargetRecord> {
  if (!isUuid(accountId)) throw destinationNotFound()
  const listed = (await tx.publishing.targetsOfPost(post.organizationId, post.id)).find(
    (t) => t.accountId === accountId,
  )
  const target = listed && (await tx.publishing.lockTarget(post.organizationId, listed.id))
  if (!target || target.postId !== post.id) throw destinationNotFound()
  return target
}

/** A move of the panel (§9.3); the state machine refuses anything else. */
async function movePanel(
  tx: Tx,
  target: PublishingTargetRecord,
  to: TargetStatus,
  patch: Omit<TargetStepPatch, 'status'> = {},
): Promise<number> {
  if (!canMoveTarget(target.status, to, 'panel'))
    throw wrongTargetState('Questa destinazione non si può più cambiare così')
  const saved = await tx.publishing.saveStep(target.organizationId, target.id, {
    ...patch,
    status: to,
  })
  if (!saved) throw destinationNotFound()
  return saved.generation
}

async function audit(
  tx: Tx,
  actor: OrgActor,
  action: 'post.retried' | 'post.verified_manually' | 'post.target_cancelled' | 'post.resumed',
  post: PostRecord,
  data: Record<string, string>,
  ip: string | null,
) {
  await tx.audit.record({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    source: 'panel',
    action,
    entity: 'post',
    entityId: post.id,
    workspaceId: post.workspaceId,
    ip,
    data,
  })
}

/** Opens the post for a write, then runs the action, then sends its jobs after the commit. */
async function onPost(
  deps: Pick<PostsDeps, 'uow' | 'queue' | 'logger'>,
  actor: OrgActor,
  input: { workspaceId: string; postId: string },
  action: (tx: Tx, current: OrgActor, post: PostRecord, scope: PostScope) => Promise<StepJob[]>,
): Promise<PostDto> {
  const { dto, jobs } = await deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope } = await openPosts(tx, actor, input.workspaceId, { write: true })
      const post = await lockedPost(tx, scope, input.postId)
      const jobs = await action(tx, current, post, scope)
      return { dto: await readPost(tx, current, scope, post.id), jobs }
    },
  )
  await sendSteps(deps, jobs)
  return dto
}

const stepJob = (
  target: PublishingTargetRecord,
  name: StepJob['name'],
  generation: number,
  at: Date,
): StepJob => ({
  name,
  organizationId: target.organizationId,
  targetId: target.id,
  generation,
  startAfter: at,
})

/**
 * A call that publishes refused by Meta used what was prepared (an Instagram container in error):
 * the next round prepares again, and what Facebook kept unpublished is thrown away. Not after
 * `too_late` (nothing was called) nor `uncertain_not_found` (the post may be out: the same
 * container answers «already published» instead of a second post).
 */
const spentRound = (target: PublishingTargetRecord) =>
  target.step === 'publish' &&
  target.metaIds !== null &&
  target.lastErrorCode !== 'too_late' &&
  target.lastErrorCode !== 'uncertain_not_found'

/**
 * «Riprova» (§9.5, plan 07 Task 8). From `failed`: back to `scheduled` at once, so the
 * preparation starts again from what it saved (the ids of Meta stay), and the 15 minutes of
 * D-77 (b) count from now. From `problem`, where the post may be on Meta: `unknown` with the
 * step `recheck`, and the worker asks Meta before publishing anything again.
 */
export function retryTarget(
  deps: Pick<PostsDeps, 'uow' | 'clock' | 'queue' | 'logger'>,
  actor: OrgActor,
  input: Input,
  request: { ip: string | null },
): Promise<PostDto> {
  return onPost(deps, actor, input, async (tx, current, post) => {
    if (!mayRetry(current, post)) throw forbidden()
    const target = await lockedTarget(tx, post, input.accountId)
    const now = deps.clock.now()
    let job: StepJob
    if (target.status === 'failed') {
      const generation = await movePanel(tx, target, 'scheduled', {
        ...(spentRound(target)
          ? { metaIds: { [DISCARD_KEY]: roundIds(target.metaIds) ?? {} } }
          : {}),
        attempts: 0,
        nextAttemptAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
        verification: retryMark(now),
      })
      job = stepJob(target, 'target.prepare', generation, now)
    } else if (target.status === 'problem') {
      const generation = await movePanel(tx, target, 'unknown', {
        step: 'recheck',
        attempts: 0,
        nextAttemptAt: now,
        lastErrorCode: null,
      })
      job = stepJob(target, 'target.reconcile', generation, now)
    } else throw wrongTargetState('Si riprova solo una destinazione non uscita o con un problema')
    await audit(
      tx,
      current,
      'post.retried',
      post,
      { accountId: target.accountId, from: target.status },
      request.ip,
    )
    return [job]
  })
}

/** «Segna come verificato» (§9.6): someone saw the post on the profile. */
export function markVerified(
  deps: Pick<PostsDeps, 'uow' | 'clock' | 'queue' | 'logger'>,
  actor: OrgActor,
  input: Input,
  request: { ip: string | null },
): Promise<PostDto> {
  return onPost(deps, actor, input, async (tx, current, post) => {
    if (!mayRetry(current, post)) throw forbidden()
    const target = await lockedTarget(tx, post, input.accountId)
    if (target.status !== 'problem' || !canMoveTarget('problem', 'confirmed', 'panel'))
      throw wrongTargetState('Si segna come verificata solo una destinazione con un problema')
    // the same move as the worker's confirmation, with its events (§12.2)
    await confirmTarget(tx, target, {
      permalink: null,
      at: deps.clock.now(),
      verification: { outcome: 'confirmed', manual: true },
      by: 'panel',
    })
    await audit(
      tx,
      current,
      'post.verified_manually',
      post,
      { accountId: target.accountId },
      request.ip,
    )
    return []
  })
}

const CANCELLABLE = new Set<TargetStatus>([
  'scheduled',
  'preparing',
  'ready',
  'retrying',
  'paused',
  'failed',
])

/**
 * «Annulla» of one destination (§11.9: once the post is under way only the destinations not out
 * yet are cancelled). What a preparation left on Facebook unpublished expires there by itself.
 */
export function cancelTarget(
  deps: Pick<PostsDeps, 'uow' | 'clock' | 'queue' | 'logger'>,
  actor: OrgActor,
  input: Input,
  request: { ip: string | null },
): Promise<PostDto> {
  return onPost(deps, actor, input, async (tx, current, post) => {
    if (!mayCancel(current, post)) throw forbidden()
    const target = await lockedTarget(tx, post, input.accountId)
    if (target.status === 'paused' && !mayManage(current, post)) throw forbidden()
    if (!CANCELLABLE.has(target.status))
      throw wrongTargetState(
        'Questa destinazione è già uscita o si sta pubblicando: non si annulla più',
      )
    await movePanel(tx, target, 'cancelled', {
      nextAttemptAt: null,
      claimedUntil: null,
      recheckAt: null,
    })
    await audit(
      tx,
      current,
      'post.target_cancelled',
      post,
      { accountId: target.accountId },
      request.ip,
    )
    return []
  })
}

/** The paused destinations of a post the person may resume or cancel (P5). */
async function pausedOf(tx: Tx, current: OrgActor, post: PostRecord, version: number) {
  if (!mayManage(current, post)) throw forbidden()
  if (post.version !== version) throw versionConflict()
  const paused = (await tx.publishing.targetsOfPost(post.organizationId, post.id)).filter(
    (t) => t.status === 'paused',
  )
  if (paused.length === 0) throw wrongTargetState('Il post non è in pausa')
  const locked: PublishingTargetRecord[] = []
  for (const t of paused) {
    const target = await tx.publishing.lockTarget(post.organizationId, t.id)
    if (target?.status === 'paused') locked.push(target)
  }
  return locked
}

/**
 * «Riprendi» (§9.3, P5, P6): the person who resumes becomes the one the post goes out with
 * (`scheduled_by`), so a post stopped because its author was demoted does not pause again. A
 * time already passed needs a new one (`when`).
 */
export function resumePaused(
  deps: Pick<PostsDeps, 'uow' | 'clock' | 'queue' | 'logger'>,
  actor: OrgActor,
  input: { workspaceId: string; postId: string; version: number; when?: PostWhenInput },
  request: { ip: string | null },
): Promise<PostDto> {
  return onPost(deps, actor, input, async (tx, current, post, scope) => {
    const paused = await pausedOf(tx, current, post, input.version)
    const now = deps.clock.now()
    const at = input.when ? scheduledAtOf(input.when, post.timezone) : post.scheduledAt
    if (at === null || at.getTime() <= now.getTime())
      throw new DomainError(
        'VALIDATION',
        input.when
          ? 'Scegli un’ora che non sia già passata'
          : 'L’ora del post è passata: scegli quando pubblicarlo',
        { field: 'when', reason: 'paused_time_passed' },
      )
    const version = await tx.posts.update(
      scope,
      post.id,
      {
        type: post.type,
        caption: post.caption,
        captionByPlatform: post.captionByPlatform,
        scheduledAt: at,
        status: 'scheduled',
        options: post.options,
        scheduledBy: current.userId,
        updatedBy: current.userId,
      },
      post.version,
    )
    if (version === null) throw versionConflict()
    const startAt = prepareAt(at, now)
    const jobs: StepJob[] = []
    for (const target of paused) {
      const generation = await movePanel(tx, target, 'scheduled', {
        attempts: 0,
        nextAttemptAt: startAt,
        recheckAt: recheckAt(at, now),
        lastErrorCode: null,
        lastErrorMessage: null,
        verification: null,
      })
      jobs.push(stepJob(target, 'target.prepare', generation, startAt))
    }
    await audit(tx, current, 'post.resumed', post, { scheduledAt: at.toISOString() }, request.ip)
    return jobs
  })
}

/** «Annulla» of a post in pause: its paused destinations go out on no account (P5). */
export function cancelPaused(
  deps: Pick<PostsDeps, 'uow' | 'clock' | 'queue' | 'logger'>,
  actor: OrgActor,
  input: { workspaceId: string; postId: string; version: number },
  request: { ip: string | null },
): Promise<PostDto> {
  return onPost(deps, actor, input, async (tx, current, post) => {
    const paused = await pausedOf(tx, current, post, input.version)
    for (const target of paused) {
      await movePanel(tx, target, 'cancelled', { nextAttemptAt: null, recheckAt: null })
      await audit(
        tx,
        current,
        'post.target_cancelled',
        post,
        { accountId: target.accountId },
        request.ip,
      )
    }
    return []
  })
}

import {
  DISCARD_KEY,
  PUBLISHING_STALE_MINUTES,
  UNCERTAIN_FIRST_SEARCH_MINUTES,
  isTooLate,
  nextAttemptAt,
  roundIds,
  verifyAt,
  withRoundIds,
} from '@app/domain'
import { PublishError } from '../../ports/platform-publisher.js'
import type {
  PlatformPublisher,
  PublishFiles,
  PublishMetaIds,
  PublishTarget,
  StepResult,
} from '../../ports/platform-publisher.js'
import type { PublishingTargetRecord } from '../../ports/publishing.js'
import type { Tx } from '../../ports/tx.js'
import { checkPostInTx } from '../../rules/index.js'
import { toCheckInput } from '../to-check-input.js'
import {
  assertTargetJob,
  failTarget,
  moveTarget,
  openAccount,
  pauseTarget,
  plusMinutes,
  publisherOf,
  sendSteps,
  skipped,
  waitTarget,
  type PublishingWorkerDeps,
  type StepJob,
  type StepLog,
  type TargetJob,
} from './context.js'
import { destinationCopies } from './files.js'

// `target.publish` (plan 07 Task 7): the call that publishes, at the post's time. `publishing`
// is written before the call: a worker stopped halfway leaves it, and the reconciler takes it
// as an uncertain outcome (`unknown`), never as something to do again. A destination that has
// its post on Meta (`external_post_id`) is never published again.

interface Call {
  target: PublishTarget
  files: PublishFiles
  publisher: PlatformPublisher
  connectionId: string
  record: PublishingTargetRecord
  generation: number
}

type Decision = { kind: 'done'; log: StepLog; jobs: StepJob[] } | { kind: 'call'; call: Call }

const done = (log: StepLog, jobs: StepJob[] = []): Decision => ({ kind: 'done', log, jobs })

const isPublishing = (t: PublishingTargetRecord) =>
  t.status === 'ready' || (t.status === 'retrying' && t.step === 'publish')

async function decide(
  tx: Tx,
  deps: PublishingWorkerDeps,
  job: TargetJob,
  now: Date,
): Promise<Decision> {
  const target = await tx.publishing.lockTarget(job.organizationId, job.targetId)
  if (!target || target.generation !== job.generation) return done(skipped('moved on'))
  if (!isPublishing(target)) return done(skipped(`not publishing (${target.status})`))
  if (target.externalPostId !== null) return done(skipped('already on the platform'))
  const scope = { organizationId: target.organizationId, workspaceId: target.workspaceId }
  const post = await tx.posts.find(scope, target.postId)
  if (!post?.scheduledAt) return done(skipped('post without a time'))
  // a job sent early (its time moved later): it waits for the time, in a new generation
  if (post.scheduledAt.getTime() > now.getTime()) {
    const wait = await waitTarget(tx, target, 'target.publish', post.scheduledAt, 'before its time')
    return done(wait.log, [wait.job])
  }
  const organization = await tx.organizations.findById(target.organizationId)
  if (organization?.status !== 'active')
    return done(await pauseTarget(tx, target, 'organization_suspended'))
  const actor = await publisherOf(tx, post)
  if (!actor) return done(await pauseTarget(tx, target, 'author_lost_permission'))
  // D-77 (b): a worker stopped past the time does not publish late; the attempts after an
  // error go on (`retrying`), and a preparation that ended late is measured from its end
  // (`next_attempt_at` of `ready`: the time, or the end of a preparation past it)
  const dueAt = target.nextAttemptAt ?? post.scheduledAt
  if (target.status === 'ready' && isTooLate(dueAt, now))
    return done(await failTarget(tx, target, 'too_late'))
  const report = await checkPostInTx(tx, deps, actor, toCheckInput(post, 'publish'))
  const copies = await destinationCopies(tx, deps, post, report, target.accountId)
  if (copies.status !== 'ready') return done(await failTarget(tx, target, 'file_wont_publish'))
  const opened = await openAccount(tx, deps, target.organizationId, target.accountId)
  if (!opened) return done(await failTarget(tx, target, 'token_invalid'))
  const destination = report.destinations.find((d) => d.accountId === target.accountId)
  const generation = await moveTarget(tx, target, 'publishing', {
    step: 'publish',
    nextAttemptAt: plusMinutes(now, PUBLISHING_STALE_MINUTES),
  })
  return {
    kind: 'call',
    call: {
      record: target,
      generation,
      connectionId: opened.connectionId,
      publisher: opened.publisher,
      files: copies.files,
      target: {
        targetId: target.id,
        account: opened.account,
        credentials: opened.credentials,
        type: post.type,
        asVideo: destination?.format === 'video',
        caption: post.type === 'story' ? '' : (destination?.caption ?? ''),
        shareToFeed: post.options.shareToFeed,
        metaIds: roundIds(target.metaIds),
        externalPostId: null,
      },
    },
  }
}

/**
 * The destination again, locked, still in this call: in the same generation, or already taken
 * by the reconciler as uncertain while the call lasted (then a post found is still written).
 */
async function lockSame(tx: Tx, call: Call): Promise<PublishingTargetRecord | null> {
  const now = await tx.publishing.lockTarget(call.record.organizationId, call.record.id)
  if (!now) return null
  if (now.generation === call.generation) return now
  return now.status === 'unknown' && now.step === 'publish' && now.externalPostId === null
    ? now
    : null
}

function saverOf(deps: PublishingWorkerDeps, call: Call) {
  return async (ids: PublishMetaIds) => {
    await deps.uow.run({ organizationId: call.record.organizationId, userId: null }, async (tx) => {
      const now = await lockSame(tx, call)
      if (now)
        await tx.publishing.saveStep(now.organizationId, now.id, {
          metaIds: withRoundIds(now.metaIds, ids),
        })
    })
  }
}

async function settle(
  tx: Tx,
  call: Call,
  target: PublishingTargetRecord,
  result: StepResult | PublishError,
  now: Date,
): Promise<{ log: StepLog; jobs: StepJob[] }> {
  const { organizationId } = target
  const again = (generation: number, at: Date, name: StepJob['name'] = 'target.publish') => ({
    name,
    organizationId,
    targetId: target.id,
    generation,
    startAfter: at,
  })
  if (!(result instanceof PublishError)) {
    await tx.connections.recordUsage(organizationId, call.connectionId, result.usage)
    const metaIds = withRoundIds(target.metaIds, result.metaIds)
    if (result.outcome === 'done' && result.externalPostId !== null) {
      // the first verification (§9.6) is stage 7's Task 8, at `next_attempt_at`
      await moveTarget(tx, target, 'published', {
        step: 'verify',
        metaIds,
        externalPostId: result.externalPostId,
        permalink: result.permalink,
        publishedAt: now,
        attempts: 0,
        nextAttemptAt: verifyAt(now, 1),
        lastErrorCode: null,
      })
      return { log: { outcome: 'moved', to: 'published' }, jobs: [] }
    }
    if (target.status === 'unknown') return { log: skipped('taken as uncertain'), jobs: [] }
    if (result.outcome === 'done')
      // done without the post's id: whether it is out only a search can tell
      return settle(
        tx,
        call,
        target,
        new PublishError({ kind: 'uncertain', code: 'meta_error' }),
        now,
      )
    if (result.outcome === 'expired') {
      // what was prepared is gone: prepared again from the start, the old ids to throw away
      const generation = await moveTarget(tx, target, 'retrying', {
        step: 'prepare',
        metaIds: { [DISCARD_KEY]: roundIds(metaIds) ?? {} },
        nextAttemptAt: now,
      })
      return {
        log: { outcome: 'moved', to: 'retrying', code: 'expired' },
        jobs: [again(generation, now, 'target.prepare')],
      }
    }
    // no posts left in the window, or a file still processing: not an attempt
    const at = result.retryAt
    const generation = await moveTarget(tx, target, 'retrying', {
      step: 'publish',
      metaIds,
      nextAttemptAt: at,
      lastErrorCode: result.reason === 'quota' ? 'quota_exhausted' : null,
    })
    return { log: { outcome: 'moved', to: 'retrying' }, jobs: [again(generation, at)] }
  }
  if (target.status === 'unknown') return { log: skipped('taken as uncertain'), jobs: [] }
  if (result.kind === 'uncertain') {
    // the post may be out: searched before anything else (§9.5, Task 8)
    await moveTarget(tx, target, 'unknown', {
      step: 'publish',
      nextAttemptAt: plusMinutes(now, UNCERTAIN_FIRST_SEARCH_MINUTES),
      lastErrorCode: result.code,
    })
    return { log: { outcome: 'moved', to: 'unknown', code: result.code }, jobs: [] }
  }
  if (result.kind === 'permanent')
    return { log: await failTarget(tx, target, result.code), jobs: [] }
  const attempt = target.attempts + 1
  const next = nextAttemptAt(now, attempt)
  if (next === null) return { log: await failTarget(tx, target, result.code), jobs: [] }
  const at = result.retryAt && result.retryAt > next ? result.retryAt : next
  const generation = await moveTarget(tx, target, 'retrying', {
    step: 'publish',
    attempts: attempt,
    nextAttemptAt: at,
    lastErrorCode: result.code,
  })
  return {
    log: { outcome: 'moved', to: 'retrying', code: result.code },
    jobs: [again(generation, at)],
  }
}

export async function publishTarget(deps: PublishingWorkerDeps, job: TargetJob): Promise<StepLog> {
  assertTargetJob(job)
  const scope = { organizationId: job.organizationId, userId: null }
  const decision = await deps.uow.run(scope, (tx) => decide(tx, deps, job, deps.clock.now()))
  if (decision.kind === 'done') {
    await sendSteps(deps, decision.jobs)
    return decision.log
  }
  const { call } = decision
  const started = deps.clock.now().getTime()
  let result: StepResult | PublishError
  try {
    result = await call.publisher.publish(call.target, call.files, {
      signal: job.signal ?? new AbortController().signal,
      saveIds: saverOf(deps, call),
    })
  } catch (error) {
    // after the call left, anything unexpected may have published: uncertain, never again
    result =
      error instanceof PublishError
        ? error
        : new PublishError({ kind: 'uncertain', code: 'meta_error' })
    if (!(error instanceof PublishError))
      deps.logger.error({ err: error, targetId: call.record.id }, 'publishing call failed')
  }
  const durationMs = deps.clock.now().getTime() - started
  const settled = await deps.uow.run(scope, async (tx) => {
    const target = await lockSame(tx, call)
    if (!target) return { log: skipped('moved during the call'), jobs: [] }
    await tx.publishing.recordAttempt({
      organizationId: target.organizationId,
      workspaceId: target.workspaceId,
      targetId: target.id,
      step: 'publish',
      outcome:
        result instanceof PublishError ? result.kind : result.outcome === 'done' ? 'done' : 'wait',
      errorCode: result instanceof PublishError ? result.code : null,
      metaErrorCode: result instanceof PublishError ? result.platformCode : null,
      durationMs,
    })
    return settle(tx, call, target, result, deps.clock.now())
  })
  await sendSteps(deps, settled.jobs)
  return settled.log
}

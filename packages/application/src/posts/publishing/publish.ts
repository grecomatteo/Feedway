import {
  DISCARD_KEY,
  PUBLISHING_STALE_MINUTES,
  SLOW_DOWN_MAX_MINUTES,
  UNCERTAIN_FIRST_SEARCH_MINUTES,
  isPastLatestStart,
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
  cancelArchived,
  clientArchived,
  failTarget,
  lateCodeOf,
  lateLimitOf,
  moveTarget,
  openAccount,
  pauseTarget,
  plusMinutes,
  latestOf,
  publisherOf,
  recordReadings,
  sendSteps,
  skipped,
  slowDownOf,
  waitTarget,
  type PublishingWorkerDeps,
  type StepJob,
  type StepLog,
  type TargetJob,
  collaboratorsOf,
} from './context.js'
import { destinationCopies } from './files.js'
import { processingOf, retriedAtOf, withProcessing } from './retry-mark.js'
import { uncertainSearch } from './search.js'

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
  /** when the step began: the uncertain search looks from here (§9.5) */
  startedAt: Date
  /** the post's time: past 60 minutes after it nothing starts (R4) */
  scheduledAt: Date
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
  // an archived client publishes nothing (D-70, R7)
  if (await clientArchived(tx, target)) return done(await cancelArchived(tx, target))
  const startAt = latestOf(post.scheduledAt, retriedAtOf(target))
  // R4: never more than 60 minutes after the time (or the «Riprova»), whatever held it
  if (isPastLatestStart(startAt, now)) return done(await failTarget(tx, target, lateCodeOf(target)))
  // D-77 (b) and D-118: past the 15 minutes nothing goes out, a worker stopped or an attempt
  // after an error; a file being processed waits up to the 60 minutes above. A preparation
  // that ended late (a file being processed, or a call that ran over the 15 minutes) counts
  // from its end: `next_attempt_at` of `ready`
  const readyAt = target.nextAttemptAt ?? post.scheduledAt
  const dueAt = target.status === 'ready' && isTooLate(startAt, readyAt) ? readyAt : startAt
  if (!processingOf(target) && isTooLate(dueAt, now))
    return done(await failTarget(tx, target, lateCodeOf(target)))
  // only above 95% of Meta's usage (§8.6): at 85% the post still goes out at its time. At most
  // 5 minutes after the post's time, whatever the waits: a wait moves `next_attempt_at`, so
  // without this bound waits one after the other would publish late without end (D-77 b)
  const slowUntil = await slowDownOf(tx, target, 'publish', now)
  const slowLimit = plusMinutes(post.scheduledAt, SLOW_DOWN_MAX_MINUTES)
  if (slowUntil && slowUntil.getTime() <= slowLimit.getTime()) {
    const wait = await waitTarget(tx, target, 'target.publish', slowUntil, 'slowing down')
    return done(wait.log, [wait.job])
  }
  const report = await checkPostInTx(tx, deps, actor, toCheckInput(post, 'publish'))
  const copies = await destinationCopies(tx, deps, post, report, target.accountId)
  if (copies.status === 'no_public_host')
    return done(await failTarget(tx, target, 'public_host_off'))
  if (copies.status !== 'ready') return done(await failTarget(tx, target, 'file_wont_publish'))
  const opened = await openAccount(tx, deps, target.organizationId, target.accountId)
  if (!opened) return done(await failTarget(tx, target, 'token_invalid'))
  const destination = report.destinations.find((d) => d.accountId === target.accountId)
  const generation = await moveTarget(tx, target, 'publishing', {
    step: 'publish',
    nextAttemptAt: plusMinutes(now, PUBLISHING_STALE_MINUTES),
    verification: withProcessing(target, false),
  })
  return {
    kind: 'call',
    call: {
      record: target,
      generation,
      startedAt: now,
      scheduledAt: post.scheduledAt,
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
        collaborators: collaboratorsOf(post, opened.account.platform),
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
  await recordReadings(tx, target, result, now)
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
      // the first verification (§9.6), 3 minutes later
      const verifyFirst = verifyAt(now, 1) ?? now
      const generation = await moveTarget(tx, target, 'published', {
        step: 'verify',
        metaIds,
        externalPostId: result.externalPostId,
        permalink: result.permalink,
        publishedAt: now,
        attempts: 0,
        nextAttemptAt: verifyFirst,
        lastErrorCode: null,
        verification: null,
      })
      return {
        log: { outcome: 'moved', to: 'published' },
        jobs: [again(generation, verifyFirst, 'target.verify')],
      }
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
    // R4 and D-118: a window that frees up past the 15 minutes: not out, and «Riprova» later
    if (result.reason === 'quota' && at.getTime() > lateLimitOf(call.scheduledAt, target).getTime())
      return { log: await failTarget(tx, target, 'quota_exhausted'), jobs: [] }
    const generation = await moveTarget(tx, target, 'retrying', {
      step: 'publish',
      metaIds,
      nextAttemptAt: at,
      lastErrorCode: result.reason === 'quota' ? 'quota_exhausted' : null,
      // a file being processed goes on past the 15 minutes (D-118)
      verification: withProcessing(target, result.reason === 'processing'),
    })
    return { log: { outcome: 'moved', to: 'retrying' }, jobs: [again(generation, at)] }
  }
  if (target.status === 'unknown') return { log: skipped('taken as uncertain'), jobs: [] }
  if (result.kind === 'uncertain') {
    // the post may be out: searched before anything else (§9.5)
    const searchFirst = plusMinutes(now, UNCERTAIN_FIRST_SEARCH_MINUTES)
    const generation = await moveTarget(tx, target, 'unknown', {
      step: 'publish',
      attempts: 0,
      nextAttemptAt: searchFirst,
      lastErrorCode: result.code,
      verification: uncertainSearch(call.startedAt, now),
    })
    return {
      log: { outcome: 'moved', to: 'unknown', code: result.code },
      jobs: [again(generation, searchFirst, 'target.reconcile')],
    }
  }
  if (result.kind === 'permanent')
    return { log: await failTarget(tx, target, result.code), jobs: [] }
  const attempt = target.attempts + 1
  const next = nextAttemptAt(now, attempt)
  if (next === null) return { log: await failTarget(tx, target, result.code), jobs: [] }
  // not before Meta serves the account again (§8.6): the answer said how busy it is
  const at = latestOf(next, result.retryAt, await slowDownOf(tx, target, 'publish', now))
  // D-118: an attempt past the 15 minutes would not go out: the destination ends now
  if (at.getTime() > lateLimitOf(call.scheduledAt, target).getTime())
    return { log: await failTarget(tx, target, result.code), jobs: [] }
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

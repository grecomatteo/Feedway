import {
  DISCARD_KEY,
  PREPARE_CLAIM_MINUTES,
  PREPARE_FILE_WAIT_MINUTES,
  PREPARE_PER_ACCOUNT,
  PREPARE_PER_ORGANIZATION,
  PREPARE_TURN_WAIT_SECONDS,
  idsToDiscard,
  isTooLate,
  nextAttemptAt,
  roundIds,
  withRoundIds,
  type PublishErrorCode,
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
  blocksOf,
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

// `target.prepare` (plan 07 Task 7): everything before the post goes out, from 15 minutes
// before its time: the checks again, the person who scheduled, the copies, a place among the
// agency's preparations, then the platform's uploads and containers. The ids are saved after
// every call (§8.5), so a worker stopped halfway resumes where it was.

/** The blocks of the checks that wait for a file, instead of failing the destination. */
const WAITS = new Set(['media_processing'])

/** The block's code as the destination's reason (§9.5). */
function failureOf(blocks: readonly string[]): PublishErrorCode {
  if (blocks.includes('account_unhealthy')) return 'token_invalid'
  if (blocks.includes('account_unavailable')) return 'permission_missing'
  return 'file_wont_publish'
}

interface Call {
  target: PublishTarget
  files: PublishFiles
  publisher: PlatformPublisher
  connectionId: string
  record: PublishingTargetRecord
  generation: number
  scheduledAt: Date
  discard: PublishMetaIds | null
}

type Decision =
  | { kind: 'done'; log: StepLog; jobs: StepJob[]; wakeCopies?: string }
  | {
      kind: 'call'
      call: Call
    }

const done = (log: StepLog, jobs: StepJob[] = []): Decision => ({ kind: 'done', log, jobs })

const PREPARING = new Set(['scheduled', 'preparing'])

/** The destination's step is a preparation: a new round, one under way, or one to try again. */
const isPreparing = (t: PublishingTargetRecord) =>
  PREPARING.has(t.status) || (t.status === 'retrying' && t.step !== 'publish')

async function decide(
  tx: Tx,
  deps: PublishingWorkerDeps,
  job: TargetJob,
  now: Date,
): Promise<Decision> {
  const target = await tx.publishing.lockTarget(job.organizationId, job.targetId)
  if (!target || target.generation !== job.generation) return done(skipped('moved on'))
  if (!isPreparing(target)) return done(skipped(`not preparing (${target.status})`))
  const scope = { organizationId: target.organizationId, workspaceId: target.workspaceId }
  const post = await tx.posts.find(scope, target.postId)
  if (!post?.scheduledAt) return done(skipped('post without a time'))
  const organization = await tx.organizations.findById(target.organizationId)
  if (organization?.status !== 'active')
    return done(await pauseTarget(tx, target, 'organization_suspended'))
  const actor = await publisherOf(tx, post)
  if (!actor) return done(await pauseTarget(tx, target, 'author_lost_permission'))
  // D-77 (b): only the first start; a preparation under way or tried again goes on
  if (target.status === 'scheduled' && isTooLate(post.scheduledAt, now))
    return done(await failTarget(tx, target, 'too_late'))

  const report = await checkPostInTx(tx, deps, actor, toCheckInput(post, 'publish'))
  const blocks = blocksOf(report, target.accountId)
  if (blocks.some((b) => WAITS.has(b)) && blocks.every((b) => WAITS.has(b))) {
    const wait = await waitTarget(
      tx,
      target,
      'target.prepare',
      plusMinutes(now, PREPARE_FILE_WAIT_MINUTES),
      'file processing',
    )
    return done(wait.log, [wait.job])
  }
  if (blocks.length > 0) return done(await failTarget(tx, target, failureOf(blocks)))

  const copies = await destinationCopies(tx, deps, post, report, target.accountId)
  if (copies.status === 'failed') return done(await failTarget(tx, target, 'file_wont_publish'))
  if (copies.status === 'pending') {
    const wait = await waitTarget(
      tx,
      target,
      'target.prepare',
      plusMinutes(now, PREPARE_FILE_WAIT_MINUTES),
      'copies being made',
    )
    return {
      kind: 'done',
      log: wait.log,
      jobs: [wait.job],
      ...(copies.asked > 0 ? { wakeCopies: post.id } : {}),
    }
  }

  const opened = await openAccount(tx, deps, target.organizationId, target.accountId)
  if (!opened) return done(await failTarget(tx, target, 'token_invalid'))
  const claimed = await tx.publishing.claimPrepare(target.organizationId, target.id, {
    now,
    until: plusMinutes(now, PREPARE_CLAIM_MINUTES),
    perOrganization: PREPARE_PER_ORGANIZATION,
    perAccount: PREPARE_PER_ACCOUNT,
  })
  if (!claimed) {
    // the turn is not an attempt (plan 07 «Lavori pesanti»)
    const wait = await waitTarget(
      tx,
      target,
      'target.prepare',
      new Date(now.getTime() + PREPARE_TURN_WAIT_SECONDS * 1000),
      'waiting for its turn',
    )
    return done(wait.log, [wait.job])
  }
  const destination = report.destinations.find((d) => d.accountId === target.accountId)
  // the reconciler sends the step again if the worker stops: after the claim, not during it
  const generation = await moveTarget(tx, target, 'preparing', {
    step: 'prepare',
    nextAttemptAt: plusMinutes(now, PREPARE_CLAIM_MINUTES),
  })
  return {
    kind: 'call',
    call: {
      record: target,
      generation,
      scheduledAt: post.scheduledAt,
      connectionId: opened.connectionId,
      publisher: opened.publisher,
      discard: idsToDiscard(target.metaIds),
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
        externalPostId: target.externalPostId,
      },
    },
  }
}

/**
 * Reads the destination again, locked: null when it moved meanwhile (the post was changed):
 * then this round's outcome is not written over the new one.
 */
async function lockSame(tx: Tx, call: Call): Promise<PublishingTargetRecord | null> {
  const now = await tx.publishing.lockTarget(call.record.organizationId, call.record.id)
  return now && now.generation === call.generation ? now : null
}

/** The ids of every call, saved before the next one (§8.5), while the round is still this one. */
function saverOf(deps: PublishingWorkerDeps, call: Call) {
  return async (ids: PublishMetaIds) => {
    const saved = await deps.uow.run(
      { organizationId: call.record.organizationId, userId: null },
      async (tx) => {
        const now = await lockSame(tx, call)
        if (!now) return false
        await tx.publishing.saveStep(now.organizationId, now.id, {
          metaIds: withRoundIds(now.metaIds, ids),
        })
        return true
      },
    )
    if (!saved) deps.logger.warn({ targetId: call.record.id }, 'ids of an old round not saved')
  }
}

/** What an old round left on Meta, thrown away before the new one (P2); never a blocker. */
async function discardOld(deps: PublishingWorkerDeps, call: Call, signal: AbortSignal) {
  if (call.discard === null) return
  try {
    await call.publisher.discard({ ...call.target, metaIds: call.discard }, signal)
  } catch (error) {
    // a photo left unpublished on the Page, a container that expires by itself in 24 hours
    deps.logger.warn(
      { targetId: call.record.id, code: error instanceof PublishError ? error.code : null },
      'old preparation not thrown away',
    )
  }
  await deps.uow.run({ organizationId: call.record.organizationId, userId: null }, async (tx) => {
    const now = await lockSame(tx, call)
    if (now)
      await tx.publishing.saveStep(now.organizationId, now.id, { metaIds: roundIds(now.metaIds) })
  })
}

/** The outcome of the platform's preparation on the destination. */
async function settle(
  tx: Tx,
  deps: PublishingWorkerDeps,
  call: Call,
  target: PublishingTargetRecord,
  result: StepResult | PublishError,
  now: Date,
): Promise<{ log: StepLog; jobs: StepJob[] }> {
  const { organizationId } = target
  if (!(result instanceof PublishError)) {
    await tx.connections.recordUsage(organizationId, call.connectionId, result.usage)
    const metaIds = withRoundIds(target.metaIds, result.metaIds)
    if (result.outcome === 'done') {
      // ready: published at its time, or at once when its time has come
      const at = call.scheduledAt.getTime() > now.getTime() ? call.scheduledAt : now
      const generation = await moveTarget(tx, target, 'ready', {
        step: 'publish',
        metaIds,
        attempts: 0,
        nextAttemptAt: at,
        claimedUntil: null,
        lastErrorCode: null,
      })
      return {
        log: { outcome: 'moved', to: 'ready' },
        jobs: [
          {
            name: 'target.publish',
            organizationId,
            targetId: target.id,
            generation,
            startAfter: at,
          },
        ],
      }
    }
    // a container still processing, or no posts left in the window: not an attempt
    const at = result.outcome === 'wait' ? result.retryAt : now
    const quota = result.outcome === 'wait' && result.reason === 'quota'
    if (quota) {
      const generation = await moveTarget(tx, target, 'retrying', {
        step: 'prepare',
        metaIds,
        nextAttemptAt: at,
        claimedUntil: null,
        lastErrorCode: 'quota_exhausted',
      })
      return {
        log: { outcome: 'moved', to: 'retrying', code: 'quota_exhausted' },
        jobs: [
          {
            name: 'target.prepare',
            organizationId,
            targetId: target.id,
            generation,
            startAfter: at,
          },
        ],
      }
    }
    // `expired` starts again from the start: what was prepared is thrown away first
    const wait = await waitTarget(tx, target, 'target.prepare', at, result.outcome, {
      metaIds: result.outcome === 'expired' ? { [DISCARD_KEY]: roundIds(metaIds) ?? {} } : metaIds,
    })
    return { log: wait.log, jobs: [wait.job] }
  }
  // an uncertain answer to a preparation published nothing: it counts as a failed attempt
  if (result.kind === 'permanent')
    return { log: await failTarget(tx, target, result.code), jobs: [] }
  const attempt = target.attempts + 1
  const next = nextAttemptAt(now, attempt)
  if (next === null) return { log: await failTarget(tx, target, result.code), jobs: [] }
  const at = result.retryAt && result.retryAt > next ? result.retryAt : next
  const generation = await moveTarget(tx, target, 'retrying', {
    step: 'prepare',
    attempts: attempt,
    nextAttemptAt: at,
    claimedUntil: null,
    lastErrorCode: result.code,
  })
  return {
    log: { outcome: 'moved', to: 'retrying', code: result.code },
    jobs: [
      { name: 'target.prepare', organizationId, targetId: target.id, generation, startAfter: at },
    ],
  }
}

export async function prepareTarget(deps: PublishingWorkerDeps, job: TargetJob): Promise<StepLog> {
  assertTargetJob(job)
  const scope = { organizationId: job.organizationId, userId: null }
  const decision = await deps.uow.run(scope, (tx) => decide(tx, deps, job, deps.clock.now()))
  if (decision.kind === 'done') {
    await sendSteps(deps, decision.jobs)
    if (decision.wakeCopies)
      await deps.queue
        .send('media.publish_copies', {
          organizationId: job.organizationId,
          postId: decision.wakeCopies,
        })
        .catch((error: unknown) => {
          deps.logger.error({ err: error }, 'publish copies wake-up not queued')
        })
    return decision.log
  }
  const { call } = decision
  const signal = job.signal ?? new AbortController().signal
  await discardOld(deps, call, signal)
  const started = deps.clock.now().getTime()
  let result: StepResult | PublishError
  try {
    result = await call.publisher.prepare(call.target, call.files, {
      signal,
      saveIds: saverOf(deps, call),
    })
  } catch (error) {
    // a worker stopping: the destination stays as it is, the reconciler resumes it from the
    // ids saved once the claim has expired
    if (signal.aborted && !(error instanceof PublishError)) throw error
    // an answer never seen, or a bug: an attempt as a temporary error, so that the destination
    // has an end (`failed` after the last one) and every attempt has a new job
    if (!(error instanceof PublishError))
      deps.logger.error({ err: error, targetId: call.record.id }, 'preparation failed unexpectedly')
    result =
      error instanceof PublishError
        ? error
        : new PublishError({ kind: 'transient', code: 'meta_error' })
  }
  const durationMs = deps.clock.now().getTime() - started
  const settled = await deps.uow.run(scope, async (tx) => {
    const target = await lockSame(tx, call)
    if (!target) return { log: skipped('changed during the preparation'), jobs: [] }
    await tx.publishing.recordAttempt({
      organizationId: target.organizationId,
      workspaceId: target.workspaceId,
      targetId: target.id,
      step: 'prepare',
      outcome:
        result instanceof PublishError ? result.kind : result.outcome === 'done' ? 'done' : 'wait',
      errorCode: result instanceof PublishError ? result.code : null,
      metaErrorCode: result instanceof PublishError ? result.platformCode : null,
      durationMs,
    })
    return settle(tx, deps, call, target, result, deps.clock.now())
  })
  await sendSteps(deps, settled.jobs)
  return settled.log
}

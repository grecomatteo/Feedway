import { verifyAt, withRoundIds } from '@app/domain'
import { PublishError } from '../../ports/platform-publisher.js'
import type {
  PlatformPublisher,
  PublishTarget,
  VerifyResult,
} from '../../ports/platform-publisher.js'
import type { PublishingTargetRecord } from '../../ports/publishing.js'
import type { Tx } from '../../ports/tx.js'
import {
  assertTargetJob,
  confirmTarget,
  eventOf,
  latestOf,
  moveTarget,
  readTargetOf,
  recordReadings,
  sendSteps,
  skipped,
  type PublishingWorkerDeps,
  type StepJob,
  type StepLog,
  type TargetJob,
} from './context.js'
import { hasInvitationsToRead, sendCollaboratorsRefresh } from './collaborators.js'
import { publishedCover } from './files.js'

// `target.verify` (§9.6; plan 07 Task 8): an answer of Meta that says «published» is not
// enough, a reel can still fail while it is processed. 3 minutes after publishing the post is
// read back, then at 10 and 30 minutes while Meta is still working on it: `confirmed` with its
// link, or `problem`. Only reads, nothing that could publish twice: the one write is the cover
// of a Facebook reel, sent once Meta has processed the reel (D-120.9, review R5).

/** Why a destination is `problem` (`post_targets.verification.reason`). */
export type ProblemReason = 'not_found' | 'failed' | 'wrong_type' | 'still_processing'

interface Check {
  record: PublishingTargetRecord
  generation: number
  target: PublishTarget
  publisher: PlatformPublisher
  connectionId: string
}

type Decision =
  | { kind: 'done'; log: StepLog; jobs: StepJob[] }
  | { kind: 'call'; check: Check }
  | { kind: 'unreachable'; record: PublishingTargetRecord; generation: number }

const done = (log: StepLog, jobs: StepJob[] = []): Decision => ({ kind: 'done', log, jobs })

/** `problem` with its reason, and the event stage 8 tells of (§12.2). */
export async function problemTarget(
  tx: Tx,
  target: PublishingTargetRecord,
  reason: ProblemReason,
  round: number,
): Promise<StepLog> {
  await moveTarget(tx, target, 'problem', {
    verification: { outcome: 'problem', reason, round },
    nextAttemptAt: null,
  })
  await tx.outbox.record({
    organizationId: target.organizationId,
    type: 'post.target_problem',
    payload: { ...eventOf(target, null), reason },
  })
  return { outcome: 'moved', to: 'problem', code: reason }
}

async function decide(tx: Tx, deps: PublishingWorkerDeps, job: TargetJob): Promise<Decision> {
  const target = await tx.publishing.lockTarget(job.organizationId, job.targetId)
  if (!target || target.generation !== job.generation) return done(skipped('moved on'))
  if (target.status !== 'published' && target.status !== 'verifying')
    return done(skipped(`not verifying (${target.status})`))
  const scope = { organizationId: target.organizationId, workspaceId: target.workspaceId }
  const post = await tx.posts.find(scope, target.postId)
  if (!post) return done(skipped('post gone'))
  const generation =
    target.status === 'published'
      ? await moveTarget(tx, target, 'verifying', { step: 'verify' })
      : target.generation
  const read = await readTargetOf(tx, deps, target, post)
  if (!read) return { kind: 'unreachable', record: target, generation }
  return { kind: 'call', check: { record: target, generation, ...read } }
}

/**
 * When the rounds are counted from: the publication, or the moment a search found the post
 * again (`verifyFrom`, after an uncertain call or a «Riprova»), so the rounds are not all past.
 */
const fromOf = (target: PublishingTargetRecord) => {
  const from = verifyFromOf(target)
  return from === null ? {} : { verifyFrom: from.toISOString() }
}

function verifyFromOf(target: PublishingTargetRecord): Date | null {
  const raw = (target.verification as { verifyFrom?: unknown } | null)?.verifyFrom
  const at = typeof raw === 'string' ? new Date(raw) : null
  return at && Number.isFinite(at.getTime()) ? at : null
}

/**
 * The next round, or `problem` after the last: still processing (or never read) 30 minutes after
 * publishing (§9.6).
 */
async function lookAgain(
  tx: Tx,
  target: PublishingTargetRecord,
  round: number,
  now: Date,
): Promise<{ log: StepLog; jobs: StepJob[] }> {
  const next = verifyAt(verifyFromOf(target) ?? target.publishedAt ?? now, round + 1)
  if (next === null)
    return { log: await problemTarget(tx, target, 'still_processing', round), jobs: [] }
  const at = latestOf(next, now)
  const saved = await tx.publishing.saveStep(target.organizationId, target.id, {
    attempts: round,
    nextAttemptAt: at,
    verification: { ...fromOf(target), outcome: 'pending', round },
    renew: true,
  })
  if (!saved) throw new Error('destination gone while locked')
  return {
    log: { outcome: 'waiting', why: 'still processing' },
    jobs: [
      {
        name: 'target.verify',
        organizationId: target.organizationId,
        targetId: target.id,
        generation: saved.generation,
        startAfter: at,
      },
    ],
  }
}

async function settle(
  tx: Tx,
  check: Pick<Check, 'connectionId'> | null,
  target: PublishingTargetRecord,
  result: VerifyResult | PublishError | null,
  now: Date,
): Promise<{ log: StepLog; jobs: StepJob[] }> {
  const round = target.attempts + 1
  if (result !== null) await recordReadings(tx, target, result, now)
  // what the check changed on the platform (the cover of a Facebook reel, review R5)
  if (result !== null && !(result instanceof PublishError) && result.metaIds !== undefined)
    await tx.publishing.saveStep(target.organizationId, target.id, {
      metaIds: withRoundIds(target.metaIds, result.metaIds),
    })
  // an error or an account out of reach is a round without an answer: looked at again
  if (result === null || result instanceof PublishError) return lookAgain(tx, target, round, now)
  if (check)
    await tx.connections.recordUsage(target.organizationId, check.connectionId, result.usage)
  if (result.outcome === 'confirmed')
    return {
      log: await confirmTarget(tx, target, {
        permalink: result.permalink,
        at: now,
        verification: { outcome: 'confirmed', round },
      }),
      jobs: [],
    }
  if (result.outcome === 'pending') return lookAgain(tx, target, round, now)
  return { log: await problemTarget(tx, target, result.reason, round), jobs: [] }
}

export async function verifyTarget(deps: PublishingWorkerDeps, job: TargetJob): Promise<StepLog> {
  assertTargetJob(job)
  const scope = { organizationId: job.organizationId, userId: null }
  const decision = await deps.uow.run(scope, (tx) => decide(tx, deps, job))
  if (decision.kind === 'done') {
    await sendSteps(deps, decision.jobs)
    return decision.log
  }
  const record = decision.kind === 'call' ? decision.check.record : decision.record
  const generation = decision.kind === 'call' ? decision.check.generation : decision.generation
  let result: VerifyResult | PublishError | null = null
  const started = deps.clock.now().getTime()
  if (decision.kind === 'call') {
    const { check } = decision
    try {
      const now = deps.clock.now()
      const from = verifyFromOf(record) ?? record.publishedAt ?? now
      result = await check.publisher.verify(
        check.target,
        job.signal ?? new AbortController().signal,
        {
          // only when the publisher sends a cover now: no query and no read otherwise
          readCover: () => publishedCover(deps, record),
          lastRound: verifyAt(from, record.attempts + 2) === null,
        },
      )
    } catch (error) {
      result =
        error instanceof PublishError
          ? error
          : new PublishError({ kind: 'transient', code: 'meta_error' })
      if (!(error instanceof PublishError))
        deps.logger.error({ err: error, targetId: record.id }, 'verification call failed')
    }
  }
  const durationMs = deps.clock.now().getTime() - started
  const settled = await deps.uow.run(scope, async (tx) => {
    const target = await tx.publishing.lockTarget(record.organizationId, record.id)
    if (target?.generation !== generation)
      return { log: skipped('moved during the call'), jobs: [] }
    await tx.publishing.recordAttempt({
      organizationId: target.organizationId,
      workspaceId: target.workspaceId,
      targetId: target.id,
      step: 'verify',
      outcome:
        result === null
          ? 'transient'
          : result instanceof PublishError
            ? result.kind
            : result.outcome === 'pending'
              ? 'wait'
              : 'done',
      errorCode:
        result === null ? 'token_invalid' : result instanceof PublishError ? result.code : null,
      metaErrorCode: result instanceof PublishError ? result.platformCode : null,
      durationMs,
    })
    return settle(
      tx,
      decision.kind === 'call' ? decision.check : null,
      target,
      result,
      deps.clock.now(),
    )
  })
  await sendSteps(deps, settled.jobs)
  // the collaborators' answers are read once the post is confirmed (D-125)
  if (
    settled.log.outcome === 'moved' &&
    settled.log.to === 'confirmed' &&
    hasInvitationsToRead({ ...record, status: 'confirmed' })
  )
    await sendCollaboratorsRefresh(deps, {
      organizationId: record.organizationId,
      postId: record.postId,
    })
  return settled.log
}

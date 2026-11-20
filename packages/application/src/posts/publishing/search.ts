import { nextAttemptAt, searchAt, verifyAt } from '@app/domain'
import { PublishError } from '../../ports/platform-publisher.js'
import type {
  FoundPost,
  PlatformPublisher,
  PublishTarget,
  VerifyResult,
} from '../../ports/platform-publisher.js'
import type { PublishingTargetRecord } from '../../ports/publishing.js'
import type { Tx } from '../../ports/tx.js'
import {
  assertTargetJob,
  confirmTarget,
  failTarget,
  latestOf,
  moveTarget,
  plusMinutes,
  readTargetOf,
  recordReadings,
  sendSteps,
  skipped,
  type PublishingWorkerDeps,
  type StepJob,
  type StepLog,
  type TargetJob,
} from './context.js'

// `target.reconcile` (§9.5; plan 07 Scelta 7, Task 8): a destination in `unknown` is looked for
// on its account before anything else, so «Riprova» never publishes it twice.
// - After an uncertain call that publishes (`step: 'publish'`): three searches, 2, 5 and 15
//   minutes later, among the last posts of the account, for the destination's text published
//   from the start of the call to 10 minutes later. Found: `published`, then verified. Not found
//   after the third: `failed` with `uncertain_not_found`.
// - After «Riprova» from `problem` (`step: 'recheck'`): the post is read again (`verify`), then
//   searched; there, `confirmed`; still processing, verified again; not on Meta, published again
//   from the preparation (`retrying`).

/**
 * What an uncertain destination keeps in `post_targets.verification`: when the call that may
 * have published started (`since`, the search window) and when it became uncertain (the
 * searches' times). Written by the moves to `unknown`.
 */
export interface UncertainSearch {
  since: string
  uncertainAt: string
}

/** The search's fields of an uncertain call that started at `since`, uncertain at `at`. */
export const uncertainSearch = (since: Date, at: Date): { search: UncertainSearch } => ({
  search: { since: since.toISOString(), uncertainAt: at.toISOString() },
})

const hasSearch = (target: PublishingTargetRecord) =>
  typeof (target.verification as { search?: unknown } | null)?.search === 'object'

function searchOf(target: PublishingTargetRecord): { since: Date; uncertainAt: Date } {
  const saved = (target.verification as { search?: Partial<UncertainSearch> } | null)?.search
  const since = saved?.since ? new Date(saved.since) : null
  const at = saved?.uncertainAt ? new Date(saved.uncertainAt) : null
  // a row without them (written before Task 8): the call started at most 6 minutes before
  const fallback = target.nextAttemptAt ?? new Date(0)
  return {
    since: since && Number.isFinite(since.getTime()) ? since : plusMinutes(fallback, -8),
    uncertainAt: at && Number.isFinite(at.getTime()) ? at : plusMinutes(fallback, -2),
  }
}

interface Look {
  record: PublishingTargetRecord
  generation: number
  read: { target: PublishTarget; publisher: PlatformPublisher; connectionId: string } | null
}

type Answer =
  { verified: VerifyResult | null; found: FoundPost | null } | { error: PublishError | null }

async function decide(tx: Tx, deps: PublishingWorkerDeps, job: TargetJob): Promise<Look | StepLog> {
  const target = await tx.publishing.lockTarget(job.organizationId, job.targetId)
  if (!target || target.generation !== job.generation) return skipped('moved on')
  if (target.status !== 'unknown') return skipped(`not uncertain (${target.status})`)
  const scope = { organizationId: target.organizationId, workspaceId: target.workspaceId }
  const post = await tx.posts.find(scope, target.postId)
  if (!post) return skipped('post gone')
  return {
    record: target,
    generation: target.generation,
    read: await readTargetOf(tx, deps, target, post),
  }
}

/** The calls of the search; an error is an answer of its own, never thrown. */
async function lookFor(look: Look, signal: AbortSignal): Promise<Answer> {
  const { record, read } = look
  if (!read) return { error: null }
  try {
    if (record.step === 'recheck') {
      const verified = await read.publisher.verify(read.target, signal)
      // there but of the wrong type: never published a second time, the verification tells
      if (verified.outcome !== 'problem' || verified.reason === 'wrong_type')
        return { verified, found: null }
      const found = await read.publisher.findPublished(
        read.target,
        record.publishedAt ?? new Date(0),
        signal,
      )
      // the same post Meta said failed is not the one looked for; the same post Meta said it
      // could not read (`not_found` may be a refusal for a while) is there: verified again
      return {
        verified,
        found:
          verified.reason === 'failed' && found?.externalPostId === record.externalPostId
            ? null
            : found,
      }
    }
    const found = await read.publisher.findPublished(read.target, searchOf(record).since, signal)
    return { verified: null, found }
  } catch (error) {
    if (error instanceof PublishError) return { error }
    throw error
  }
}

const job = (
  target: PublishingTargetRecord,
  name: StepJob['name'],
  generation: number,
  at: Date,
) => ({
  name,
  organizationId: target.organizationId,
  targetId: target.id,
  generation,
  startAfter: at,
})

/** Found on the account: out, and verified from now (§9.6). */
async function foundOut(
  tx: Tx,
  target: PublishingTargetRecord,
  found: Pick<FoundPost, 'externalPostId' | 'permalink'> & { publishedAt: Date | null },
  now: Date,
): Promise<{ log: StepLog; jobs: StepJob[] }> {
  const published = found.publishedAt && found.publishedAt < now ? found.publishedAt : now
  // the rounds count from now, so they are not all past when found late (D-112)
  const from = now
  const at = verifyAt(from, 1) ?? now
  const generation = await moveTarget(tx, target, 'published', {
    step: 'verify',
    externalPostId: found.externalPostId,
    permalink: found.permalink ?? target.permalink,
    publishedAt: target.publishedAt ?? published,
    attempts: 0,
    nextAttemptAt: at,
    lastErrorCode: null,
    verification: { verifyFrom: from.toISOString() },
  })
  return {
    log: { outcome: 'moved', to: 'published' },
    jobs: [job(target, 'target.verify', generation, at)],
  }
}

/** After an uncertain call: the next search, or `failed` after the third. */
async function searchAgain(
  tx: Tx,
  target: PublishingTargetRecord,
  now: Date,
): Promise<{ log: StepLog; jobs: StepJob[] }> {
  // a row made uncertain before Task 8 kept the publish's attempts: its searches start at one
  const round = hasSearch(target) ? target.attempts + 1 : 1
  const next = searchAt(searchOf(target).uncertainAt, round + 1)
  if (next === null) return { log: await failTarget(tx, target, 'uncertain_not_found'), jobs: [] }
  const at = latestOf(next, now)
  const saved = await tx.publishing.saveStep(target.organizationId, target.id, {
    attempts: round,
    nextAttemptAt: at,
    renew: true,
  })
  if (!saved) throw new Error('destination gone while locked')
  return {
    log: { outcome: 'waiting', why: 'not found yet' },
    jobs: [job(target, 'target.reconcile', saved.generation, at)],
  }
}

/** After «Riprova» from `problem`: what Meta said decides (Task 8). */
async function afterRecheck(
  tx: Tx,
  target: PublishingTargetRecord,
  answer: Answer,
  now: Date,
): Promise<{ log: StepLog; jobs: StepJob[] }> {
  if ('error' in answer) {
    // Meta did not answer: asked again 1, 5 and 15 minutes later, then the verification decides
    const attempt = target.attempts + 1
    const next = nextAttemptAt(now, attempt)
    if (next === null) {
      const { externalPostId } = target
      if (externalPostId === null)
        return { log: await failTarget(tx, target, answer.error?.code ?? 'meta_error'), jobs: [] }
      return foundOut(
        tx,
        target,
        { externalPostId, permalink: target.permalink, publishedAt: now },
        now,
      )
    }
    const saved = await tx.publishing.saveStep(target.organizationId, target.id, {
      attempts: attempt,
      nextAttemptAt: next,
      lastErrorCode: answer.error?.code ?? 'token_invalid',
      renew: true,
    })
    if (!saved) throw new Error('destination gone while locked')
    return {
      log: { outcome: 'waiting', why: 'Meta did not answer' },
      jobs: [job(target, 'target.reconcile', saved.generation, next)],
    }
  }
  const { verified, found } = answer
  if (verified?.outcome === 'confirmed')
    return {
      log: await confirmTarget(tx, target, {
        permalink: verified.permalink,
        at: now,
        verification: { outcome: 'confirmed', after: 'retry' },
      }),
      jobs: [],
    }
  if (
    (verified?.outcome === 'pending' ||
      (verified?.outcome === 'problem' && verified.reason === 'wrong_type')) &&
    target.externalPostId !== null
  )
    // there, still processing or of the wrong type: verified again, never published twice
    return foundOut(
      tx,
      target,
      { externalPostId: target.externalPostId, permalink: target.permalink, publishedAt: now },
      now,
    )
  if (found) return foundOut(tx, target, found, now)
  // not on Meta, or failed there: published again from the start (§9.3), with nothing of the
  // old round (its ids are of a post that went out, never to be thrown away as unpublished)
  const generation = await moveTarget(tx, target, 'retrying', {
    step: 'prepare',
    metaIds: null,
    externalPostId: null,
    permalink: null,
    publishedAt: null,
    verifiedAt: null,
    verification: null,
    attempts: 0,
    nextAttemptAt: now,
    lastErrorCode: null,
  })
  return {
    log: { outcome: 'moved', to: 'retrying', code: 'not_on_platform' },
    jobs: [job(target, 'target.prepare', generation, now)],
  }
}

export async function searchTarget(deps: PublishingWorkerDeps, data: TargetJob): Promise<StepLog> {
  assertTargetJob(data)
  const scope = { organizationId: data.organizationId, userId: null }
  const look = await deps.uow.run(scope, (tx) => decide(tx, deps, data))
  if (!('record' in look)) return look
  const started = deps.clock.now().getTime()
  const answer = await lookFor(look, data.signal ?? new AbortController().signal)
  const durationMs = deps.clock.now().getTime() - started
  const settled = await deps.uow.run(scope, async (tx) => {
    const target = await tx.publishing.lockTarget(look.record.organizationId, look.record.id)
    if (target?.generation !== look.generation)
      return { log: skipped('moved during the call'), jobs: [] }
    const error = 'error' in answer ? answer.error : null
    await tx.publishing.recordAttempt({
      organizationId: target.organizationId,
      workspaceId: target.workspaceId,
      targetId: target.id,
      step: target.step === 'recheck' ? 'recheck' : 'publish',
      outcome: 'error' in answer ? (error?.kind ?? 'transient') : 'done',
      errorCode: 'error' in answer ? (error?.code ?? 'token_invalid') : null,
      metaErrorCode: error?.platformCode ?? null,
      durationMs,
    })
    const now = deps.clock.now()
    if (error) await recordReadings(tx, target, error, now)
    else if (!('error' in answer) && answer.verified)
      await recordReadings(tx, target, answer.verified, now)
    if (target.step === 'recheck') return afterRecheck(tx, target, answer, now)
    if (!('error' in answer) && answer.found) return foundOut(tx, target, answer.found, now)
    return searchAgain(tx, target, now)
  })
  await sendSteps(deps, settled.jobs)
  return settled.log
}

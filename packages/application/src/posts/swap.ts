import { DomainError, instantToZoned, type OrgActor } from '@app/domain'
import { getAccountsForRules } from '../accounts/index.js'
import type { PostRecord } from '../ports/posts.js'
import type { Tx } from '../ports/tx.js'
import {
  cannotChangeScheduled,
  changeOf,
  contentOf,
  isScheduledForPanel,
  lockedPost,
  mayEditContent,
  mayPublish,
  openPosts,
  postNotFound,
  recordPost,
  versionConflict,
  writeParts,
  type PostsDeps,
} from './common.js'
import { scheduleSaved, type AfterSchedule } from './schedule.js'

// Two scheduled posts swap their times (Instagram's grid, plan 09 Task 12): both move, with
// the checks of «Programma», or neither does. The rules of a move in the calendar (P7) hold for
// each: the version read, the publisher's permission, a post the panel still reaches.

export interface SwapSide {
  postId: string
  version: number
}

export interface SwapInput {
  workspaceId: string
  a: SwapSide
  b: SwapSide
  /** both must go out on this account (the grid's), still waiting there */
  accountId?: string
  ip: string | null
}

export interface SwapResult {
  posts: { id: string; version: number; scheduledAt: string }[]
  /** sent by the caller after the commit (`sendAfterSchedule`), one for each post */
  after: AfterSchedule[]
}

const notScheduled = () =>
  new DomainError('CONFLICT', 'Si scambiano solo due post programmati, non ancora in uscita', {
    reason: 'post_not_scheduled',
  })

const notInGrid = () =>
  new DomainError('CONFLICT', 'Il post non è più tra i programmati di questo profilo', {
    reason: 'post_not_in_grid',
  })

/**
 * Swaps the times of two scheduled posts of the same client, in the caller's transaction. The
 * two are locked in the order of their ids, so two swaps that cross never wait on each other.
 * Each takes the other's instant, said in its own zone (D-58), then both are checked as saved:
 * a check that fails throws, and the transaction leaves both where they were. Public, for
 * `calendar`.
 */
export async function swapScheduledTimes(
  tx: Tx,
  deps: PostsDeps,
  actor: OrgActor,
  input: SwapInput,
): Promise<SwapResult> {
  const { current, scope, organization } = await openPosts(tx, actor, input.workspaceId, {
    write: true,
  })
  if (!organization) throw postNotFound()
  if (input.accountId !== undefined) {
    // the grid is of one Instagram account of the client: another one is not there
    const accounts = await getAccountsForRules(tx, scope, [input.accountId])
    if (accounts.get(input.accountId)?.platform !== 'instagram')
      throw new DomainError('NOT_FOUND', 'Account non trovato')
  }
  const sides = [input.a, input.b].sort((x, y) => x.postId.localeCompare(y.postId))
  const locked = new Map<string, PostRecord>()
  for (const side of sides)
    if (!locked.has(side.postId)) locked.set(side.postId, await lockedPost(tx, scope, side.postId))
  if (input.a.postId === input.b.postId)
    throw new DomainError('VALIDATION', 'Scegli due post diversi', { field: 'b' })
  const a = locked.get(input.a.postId)
  const b = locked.get(input.b.postId)
  if (!a || !b) throw postNotFound()

  for (const [post, side] of [
    [a, input.a],
    [b, input.b],
  ] as const) {
    if (!mayEditContent(current, post) || !mayPublish(current, post)) throw cannotChangeScheduled()
    if (post.version !== side.version) throw versionConflict()
    if (post.scheduledAt === null || !(await isScheduledForPanel(tx, post))) throw notScheduled()
    if (
      input.accountId !== undefined &&
      !post.targets.some((t) => t.accountId === input.accountId && t.status !== 'cancelled')
    )
      throw notInGrid()
  }
  const atA = a.scheduledAt as Date
  const atB = b.scheduledAt as Date

  // the same lock as «Programma»: the checks of the two see every other schedule as it is
  await tx.posts.lockSchedule(scope.organizationId)
  const moves = [
    { post: a, to: atB },
    { post: b, to: atA },
  ]
  // both rows first, then the checks: each is judged with the other already in its place
  for (const { post, to } of moves) {
    const { localDate, localTime } = instantToZoned(to, post.timezone)
    const content = contentOf(post, { localDate, localTime })
    const change = { ...changeOf(post, content, current.userId, 'scheduled'), scheduledAt: to }
    const version = await tx.posts.update(scope, post.id, change, post.version)
    if (version === null) throw versionConflict()
    await writeParts(tx, scope, post.id, content, 'scheduled')
  }
  const after: AfterSchedule[] = []
  for (const { post } of moves) {
    after.push(
      await scheduleSaved(tx, deps, current, organization, scope, post.id, post.scheduledAt),
    )
    await recordPost(tx, current, 'post.updated', post, input.ip)
  }
  const posts = []
  for (const { post, to } of moves) {
    const saved = await tx.posts.find(scope, post.id)
    if (!saved) throw postNotFound()
    posts.push({ id: saved.id, version: saved.version, scheduledAt: to.toISOString() })
  }
  return { posts, after }
}

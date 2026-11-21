import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'
import type {
  IdGenerator,
  PostRecord,
  PostRepository,
  PostScope,
  PostTargetRecord,
} from '@app/application'
import {
  CANCELLED_IN_PANEL_KEY,
  DISCARD_KEY,
  compareUses,
  postStatusFromTargets,
  type MediaUse,
} from '@app/domain'
import type {
  Platform,
  PostCover,
  PostOptions,
  PostStatus,
  PostType,
  PublishingPostStatus,
  TargetStatus,
} from '@app/domain'
import type { DbExecutor } from '../client.js'
import { postLabels, postMedia, postNotes, posts, postTargets } from './schema.js'

// Every query filters by agency and workspace in SQL as well: row level security is the second
// barrier.

const postColumns = {
  id: posts.id,
  organizationId: posts.organizationId,
  workspaceId: posts.workspaceId,
  type: posts.type,
  caption: posts.caption,
  captionByPlatform: posts.captionByPlatform,
  scheduledAt: posts.scheduledAt,
  timezone: posts.timezone,
  status: posts.status,
  options: posts.options,
  createdBy: posts.createdBy,
  scheduledBy: posts.scheduledBy,
  updatedBy: posts.updatedBy,
  version: posts.version,
  createdAt: posts.createdAt,
  updatedAt: posts.updatedAt,
}

type PostRow = Omit<
  PostRecord,
  | 'type'
  | 'status'
  | 'captionByPlatform'
  | 'options'
  | 'mediaIds'
  | 'cover'
  | 'targets'
  | 'labelIds'
> & {
  type: string
  status: string
  captionByPlatform: unknown
  options: unknown
}

const noteColumns = {
  id: postNotes.id,
  postId: postNotes.postId,
  authorId: postNotes.authorId,
  body: postNotes.body,
  createdAt: postNotes.createdAt,
}

const notesOf = (scope: PostScope, postId: string) =>
  and(
    eq(postNotes.organizationId, scope.organizationId),
    eq(postNotes.workspaceId, scope.workspaceId),
    eq(postNotes.postId, postId),
  )

const inScope = (scope: PostScope) =>
  and(eq(posts.organizationId, scope.organizationId), eq(posts.workspaceId, scope.workspaceId))

/** The files, covers, destinations and labels of the posts read, in one query each. */
async function complete(
  db: DbExecutor,
  organizationId: string,
  rows: PostRow[],
): Promise<PostRecord[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const [files, targets, labels] = await Promise.all([
    db
      .select({
        postId: postMedia.postId,
        mediaId: postMedia.mediaId,
        coverMediaId: postMedia.coverMediaId,
        coverOffsetMs: postMedia.coverOffsetMs,
      })
      .from(postMedia)
      .where(and(eq(postMedia.organizationId, organizationId), inArray(postMedia.postId, ids)))
      .orderBy(asc(postMedia.postId), asc(postMedia.position)),
    db
      .select({
        postId: postTargets.postId,
        id: postTargets.id,
        accountId: postTargets.accountId,
        status: postTargets.status,
        fingerprint: postTargets.fingerprint,
        cancelledInPanel: sql<boolean>`coalesce((${postTargets.verification} -> ${CANCELLED_IN_PANEL_KEY}::text) = 'true'::jsonb, false)`,
      })
      .from(postTargets)
      .where(and(eq(postTargets.organizationId, organizationId), inArray(postTargets.postId, ids)))
      .orderBy(asc(postTargets.createdAt), asc(postTargets.id)),
    db
      .select({ postId: postLabels.postId, labelId: postLabels.labelId })
      .from(postLabels)
      .where(and(eq(postLabels.organizationId, organizationId), inArray(postLabels.postId, ids)))
      .orderBy(asc(postLabels.createdAt), asc(postLabels.labelId)),
  ])
  return rows.map((row) => {
    const own = files.filter((f) => f.postId === row.id)
    const first = own[0]
    const cover: PostCover | null =
      first?.coverMediaId != null
        ? { source: 'image', mediaId: first.coverMediaId }
        : first?.coverOffsetMs != null
          ? { source: 'frame', offsetMs: first.coverOffsetMs }
          : null
    return {
      ...row,
      // the check constraints keep the values inside the lists
      type: row.type as PostType,
      status: row.status as PostStatus,
      captionByPlatform: row.captionByPlatform as Partial<Record<Platform, string>>,
      options: row.options as PostOptions,
      mediaIds: own.map((f) => f.mediaId),
      cover,
      targets: targets
        .filter((t) => t.postId === row.id)
        .map((t): PostTargetRecord => ({
          id: t.id,
          accountId: t.accountId,
          status: t.status as PostStatus,
          fingerprint: t.fingerprint,
          cancelledInPanel: t.cancelledInPanel,
        })),
      labelIds: labels.filter((l) => l.postId === row.id).map((l) => l.labelId),
    }
  })
}

/** The destinations' states the panel may still move (plan 07 P2); the others are going out. */
const PANEL_REACH: readonly string[] = ['scheduled', 'preparing', 'ready', 'retrying', 'cancelled']

/** The destinations the worker has not started publishing: an archived client cancels them. */
const NOT_STARTED = ['scheduled', 'preparing', 'ready', 'retrying'] as const

/**
 * The states of a post that take its place of the day (`posts_per_day`): going out or gone out,
 * all or in part (review R5). A post that did not go out, a draft or a cancelled one does not.
 */
const TAKES_ITS_DAY: readonly string[] = [
  'scheduled',
  'publishing',
  'paused',
  'published',
  'partial',
  'problem',
]

/**
 * The destinations the checks of a new post read (review R5): scheduled, on their way, paused,
 * or out (with a problem too). One that did not go out, a draft or a cancelled one used nothing
 * on Meta and is not a twin to avoid.
 */
const IN_HISTORY: readonly string[] = [
  'scheduled',
  'preparing',
  'ready',
  'publishing',
  'retrying',
  'unknown',
  'paused',
  'published',
  'verifying',
  'confirmed',
  'problem',
]
/** Of those, the ones out: what an archived client had out still counts on its accounts. */
const OUT: readonly string[] = ['published', 'verifying', 'confirmed', 'problem']

/**
 * A new round of the worker on a destination the panel moves (plan 07 P2): the jobs of the old
 * one find nothing to do, and what was prepared on Meta, which holds the old files and text,
 * waits under `DISCARD_KEY` to be thrown away by the next preparation.
 */
const NEW_ROUND = {
  generation: sql`${postTargets.generation} + 1`,
  step: null,
  attempts: 0,
  claimedUntil: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  // what a round of the worker noted (a «Riprova», a search) is of the old round
  verification: null,
  metaIds: sql`case
    when ${postTargets.metaIds} is null or (${postTargets.metaIds} - ${DISCARD_KEY}) = '{}'::jsonb
      then ${postTargets.metaIds}
    else jsonb_build_object(${DISCARD_KEY}::text, ${postTargets.metaIds} - ${DISCARD_KEY})
  end`,
  updatedAt: sql`now()`,
}

export function drizzlePosts(db: DbExecutor, ids: IdGenerator): PostRepository {
  const findOne = async (scope: PostScope, postId: string, lock: boolean) => {
    const query = db
      .select(postColumns)
      .from(posts)
      .where(and(inScope(scope), eq(posts.id, postId)))
    const rows = lock ? await query.for('update') : await query
    const [post] = await complete(db, scope.organizationId, rows)
    return post ?? null
  }
  /** The destinations not started of posts already going out: cancelled, the posts' state again. */
  const cancelWaiting = async (scope: PostScope, postIds: string[]) => {
    const ofPosts = and(
      eq(postTargets.organizationId, scope.organizationId),
      eq(postTargets.workspaceId, scope.workspaceId),
      inArray(postTargets.postId, postIds),
    )
    await db
      .update(postTargets)
      .set({
        status: 'cancelled',
        generation: sql`${postTargets.generation} + 1`,
        claimedUntil: null,
        nextAttemptAt: null,
        recheckAt: null,
        updatedAt: sql`now()`,
      })
      .where(and(ofPosts, inArray(postTargets.status, NOT_STARTED)))
    const rows = await db
      .select({ postId: postTargets.postId, status: postTargets.status })
      .from(postTargets)
      .where(ofPosts)
    for (const postId of postIds) {
      const status = postStatusFromTargets(
        rows.filter((r) => r.postId === postId).map((r) => r.status as TargetStatus),
      )
      await db
        .update(posts)
        .set({ status })
        .where(
          and(
            inScope(scope),
            eq(posts.id, postId),
            sql`${posts.status} is distinct from ${status}`,
          ),
        )
    }
  }
  return {
    async insert(post) {
      const id = post.id ?? ids.newId()
      await db.insert(posts).values({ ...post, id, updatedBy: post.createdBy })
      return id
    },
    find: (scope, postId) => findOne(scope, postId, false),
    findForUpdate: (scope, postId) => findOne(scope, postId, true),
    async update(scope, postId, change, expectedVersion) {
      const [row] = await db
        .update(posts)
        .set({ ...change, version: sql`${posts.version} + 1` })
        .where(and(inScope(scope), eq(posts.id, postId), eq(posts.version, expectedVersion)))
        .returning({ version: posts.version })
      return row?.version ?? null
    },
    async listByWorkspace(scope, page) {
      const rows = await db
        .select(postColumns)
        .from(posts)
        .where(
          and(
            inScope(scope),
            page.status === undefined ? undefined : eq(posts.status, page.status),
            page.before === undefined
              ? undefined
              : sql`(${posts.createdAt}, ${posts.id}) < (select b.created_at, b.id from ${posts} b
                     where b.organization_id = ${scope.organizationId}
                       and b.workspace_id = ${scope.workspaceId} and b.id = ${page.before})`,
          ),
        )
        .orderBy(desc(posts.createdAt), desc(posts.id))
        .limit(page.limit)
      return complete(db, scope.organizationId, rows)
    },
    async replaceMedia(scope, postId, mediaIds, cover) {
      await db
        .delete(postMedia)
        .where(
          and(
            eq(postMedia.organizationId, scope.organizationId),
            eq(postMedia.workspaceId, scope.workspaceId),
            eq(postMedia.postId, postId),
          ),
        )
      if (mediaIds.length === 0) return
      await db.insert(postMedia).values(
        mediaIds.map((mediaId, position) => ({
          ...scope,
          postId,
          position,
          mediaId,
          coverMediaId: position === 0 && cover?.source === 'image' ? cover.mediaId : null,
          coverOffsetMs: position === 0 && cover?.source === 'frame' ? cover.offsetMs : null,
        })),
      )
    },
    async replaceTargets(scope, postId, targets) {
      const ofPost = and(
        eq(postTargets.organizationId, scope.organizationId),
        eq(postTargets.workspaceId, scope.workspaceId),
        eq(postTargets.postId, postId),
      )
      // one row per account: the last one given wins
      const byAccount = new Map(targets.map((t) => [t.accountId, t]))
      const accountIds = [...byAccount.keys()]
      await db
        .delete(postTargets)
        .where(
          accountIds.length === 0
            ? ofPost
            : and(ofPost, notInArray(postTargets.accountId, accountIds)),
        )
      if (accountIds.length === 0) return
      await db
        .insert(postTargets)
        .values(
          [...byAccount.values()].map((t) => ({
            id: ids.newId(),
            ...scope,
            postId,
            ...t,
            nextAttemptAt: t.nextAttemptAt ?? null,
            recheckAt: t.recheckAt ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: [postTargets.organizationId, postTargets.postId, postTargets.accountId],
          // never a row of another workspace's post: its key would not take this one
          setWhere: eq(postTargets.workspaceId, scope.workspaceId),
          set: {
            status: sql`excluded.status`,
            fingerprint: sql`excluded.fingerprint`,
            ...NEW_ROUND,
            nextAttemptAt: sql`excluded.next_attempt_at`,
            recheckAt: sql`excluded.recheck_at`,
          },
        })
    },
    async replaceLabels(scope, postId, labelIds) {
      await db
        .delete(postLabels)
        .where(
          and(
            eq(postLabels.organizationId, scope.organizationId),
            eq(postLabels.workspaceId, scope.workspaceId),
            eq(postLabels.postId, postId),
          ),
        )
      if (labelIds.length === 0) return
      await db
        .insert(postLabels)
        .values([...new Set(labelIds)].map((labelId) => ({ ...scope, postId, labelId })))
    },
    async delete(scope, postId) {
      const deleted = await db
        .delete(posts)
        .where(and(inScope(scope), eq(posts.id, postId)))
        .returning({ id: posts.id })
      return deleted.length > 0
    },
    async lockSchedule(organizationId) {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`posts_schedule:${organizationId}`}))`,
      )
    },
    async unscheduleAll(scope, updatedBy) {
      // also those in preparation (plan 07 P2); one being published goes on. The posts are
      // locked first, as `lockTarget` does: a step holding one is waited for, and the states of
      // the destinations are read after, in a statement of their own, so a step that has just
      // taken one as `publishing` is seen (a subquery of one UPDATE would read the old ones)
      const candidates = await db
        .select({ id: posts.id })
        .from(posts)
        // `partial` and `paused` too: a destination failed or paused next to one still waiting
        // (review L1); those posts are going out, never back to draft
        .where(
          and(
            inScope(scope),
            inArray(posts.status, ['scheduled', 'publishing', 'partial', 'paused']),
          ),
        )
        .orderBy(posts.id)
        .for('update')
      if (candidates.length === 0) return []
      const candidateIds = candidates.map((r) => r.id)
      const targets = await db
        .select({ postId: postTargets.postId, status: postTargets.status })
        .from(postTargets)
        .where(
          and(
            eq(postTargets.organizationId, scope.organizationId),
            eq(postTargets.workspaceId, scope.workspaceId),
            inArray(postTargets.postId, candidateIds),
          ),
        )
        .orderBy(postTargets.id)
        .for('update')
      const going = new Set(
        targets.filter((t) => !PANEL_REACH.includes(t.status)).map((t) => t.postId),
      )
      // R7: of a post already going out, what has not started is cancelled, as the worker
      // would at its step; what is out or being published stays
      if (going.size > 0) await cancelWaiting(scope, [...going])
      const postIds = candidateIds.filter((id) => !going.has(id))
      if (postIds.length === 0) return []
      await db
        .update(posts)
        .set({ status: 'draft', updatedBy, version: sql`${posts.version} + 1` })
        .where(and(inScope(scope), inArray(posts.id, postIds)))
      await db
        .update(postTargets)
        .set({
          status: 'draft',
          fingerprint: null,
          ...NEW_ROUND,
          nextAttemptAt: null,
          recheckAt: null,
        })
        .where(
          and(
            eq(postTargets.organizationId, scope.organizationId),
            eq(postTargets.workspaceId, scope.workspaceId),
            inArray(postTargets.postId, postIds),
            // a second barrier: a destination out of the panel's reach is never touched
            inArray(postTargets.status, [...PANEL_REACH]),
          ),
        )
      return postIds
    },
    async countScheduled(organizationId, { from, to }, excludePostId) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(posts)
        .where(
          and(
            eq(posts.organizationId, organizationId),
            // an archived client's posts never go out (D-70): they take no place of the day
            sql`not exists (select 1 from workspaces w where w.organization_id = ${posts.organizationId}
                  and w.id = ${posts.workspaceId} and w.archived_at is not null)`,
            inArray(posts.status, [...TAKES_ITS_DAY]),
            gte(posts.scheduledAt, from),
            lt(posts.scheduledAt, to),
            excludePostId === undefined ? undefined : ne(posts.id, excludePostId),
          ),
        )
      return row?.n ?? 0
    },
    async listInPeriod(organizationId, workspaceIds, { from, to, statuses, limit }) {
      if (workspaceIds.length === 0 || statuses.length === 0) return []
      const rows = await db
        .select(postColumns)
        .from(posts)
        .where(
          and(
            eq(posts.organizationId, organizationId),
            inArray(posts.workspaceId, [...workspaceIds]),
            inArray(posts.status, [...statuses]),
            gte(posts.scheduledAt, from),
            lt(posts.scheduledAt, to),
          ),
        )
        .orderBy(asc(posts.scheduledAt), asc(posts.id))
        .limit(limit)
      return complete(db, organizationId, rows)
    },
    async listWithStatuses(organizationId, workspaceIds, statuses, limit) {
      if (workspaceIds.length === 0 || statuses.length === 0) return []
      const rows = await db
        .select(postColumns)
        .from(posts)
        .where(
          and(
            eq(posts.organizationId, organizationId),
            inArray(posts.workspaceId, [...workspaceIds]),
            inArray(posts.status, [...statuses]),
            isNotNull(posts.scheduledAt),
          ),
        )
        // the red ones first (not out), so the limit cuts the amber ones, never them
        .orderBy(
          sql`case when ${posts.status} in ('failed', 'partial') then 0 else 1 end`,
          desc(posts.scheduledAt),
          desc(posts.id),
        )
        .limit(limit)
      return complete(db, organizationId, rows)
    },
    async listLatestDrafts(organizationId, workspaceIds, limit) {
      if (workspaceIds.length === 0) return []
      const rows = await db
        .select(postColumns)
        .from(posts)
        .where(
          and(
            eq(posts.organizationId, organizationId),
            inArray(posts.workspaceId, [...workspaceIds]),
            eq(posts.status, 'draft'),
          ),
        )
        .orderBy(desc(posts.updatedAt), desc(posts.id))
        .limit(limit)
      return complete(db, organizationId, rows)
    },
    async countDrafts(organizationId, workspaceIds) {
      if (workspaceIds.length === 0) return 0
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(posts)
        .where(
          and(
            eq(posts.organizationId, organizationId),
            inArray(posts.workspaceId, [...workspaceIds]),
            eq(posts.status, 'draft'),
          ),
        )
      return row?.n ?? 0
    },
    async activityOf(organizationId, workspaceIds, from) {
      if (workspaceIds.length === 0) return []
      // a post being published is still «in programma» (R18): it goes out now, so its time,
      // if already past, is the panel's moment
      const ahead = sql`(${posts.status} = 'scheduled' and ${posts.scheduledAt} >= ${from})
        or ${posts.status} = 'publishing'`
      const rows = await db
        .select({
          workspaceId: posts.workspaceId,
          scheduled: sql<number>`(count(*) filter (where ${ahead}))::int`,
          nextAt: sql<
            string | null
          >`min(greatest(${posts.scheduledAt}, ${from})) filter (where ${ahead})`,
          changedAt: sql<string>`max(${posts.updatedAt})`,
        })
        .from(posts)
        .where(
          and(
            eq(posts.organizationId, organizationId),
            inArray(posts.workspaceId, [...workspaceIds]),
          ),
        )
        .groupBy(posts.workspaceId)
      // an aggregate comes back as text: the driver parses only the columns it knows
      return rows.map((r) => ({
        workspaceId: r.workspaceId,
        scheduled: r.scheduled,
        nextAt: r.nextAt === null ? null : new Date(r.nextAt),
        changedAt: new Date(r.changedAt),
      }))
    },
    async scheduledTargets(organizationId, workspaceIds, accountIds, from) {
      if (workspaceIds.length === 0 || accountIds.length === 0) return []
      return db
        .selectDistinct({
          postId: postTargets.postId,
          workspaceId: postTargets.workspaceId,
          accountId: postTargets.accountId,
        })
        .from(postTargets)
        .innerJoin(
          posts,
          and(
            eq(posts.organizationId, postTargets.organizationId),
            eq(posts.id, postTargets.postId),
          ),
        )
        .where(
          and(
            eq(postTargets.organizationId, organizationId),
            inArray(postTargets.workspaceId, [...workspaceIds]),
            inArray(postTargets.accountId, [...accountIds]),
            eq(posts.status, 'scheduled'),
            gte(posts.scheduledAt, from),
          ),
        )
    },
    async statuses(organizationId, postIds) {
      if (postIds.length === 0) return new Map()
      const rows = await db
        .select({ id: posts.id, status: posts.status })
        .from(posts)
        .where(and(eq(posts.organizationId, organizationId), inArray(posts.id, [...postIds])))
      return new Map(rows.map((r) => [r.id, r.status as PostStatus]))
    },
    async publishingFacts({ organizationId, accountIds, at, excludePostId }) {
      const facts = {
        recentFingerprints: new Map<string, Set<string>>(),
        reelsLast24h: new Map<string, number>(),
        scheduledNear: new Map<string, number>(),
      }
      if (accountIds.length === 0) return facts
      const DAY = 24 * 60 * 60 * 1000
      const weekBefore = new Date(at.getTime() - 7 * DAY)
      const weekAfter = new Date(at.getTime() + 7 * DAY)
      const dayBefore = new Date(at.getTime() - DAY)
      // when it went out, or when it goes: a post out late after a «Riprova» counts then
      const when = sql<Date | null>`coalesce(${postTargets.publishedAt}, ${posts.scheduledAt})`
      const rows = await db
        .select({
          accountId: postTargets.accountId,
          fingerprint: postTargets.fingerprint,
          type: posts.type,
          scheduledAt: when.mapWith(posts.scheduledAt),
        })
        .from(postTargets)
        .innerJoin(
          posts,
          and(
            eq(posts.organizationId, postTargets.organizationId),
            eq(posts.id, postTargets.postId),
          ),
        )
        .where(
          and(
            eq(postTargets.organizationId, organizationId),
            inArray(postTargets.accountId, [...accountIds]),
            inArray(postTargets.status, [...IN_HISTORY]),
            // as `countScheduled`: an archived client's posts never go out (D-70), but what it
            // had out is on the account
            or(
              inArray(postTargets.status, [...OUT]),
              sql`not exists (select 1 from workspaces w where w.organization_id = ${posts.organizationId}
                    and w.id = ${posts.workspaceId} and w.archived_at is not null)`,
            ),
            excludePostId === undefined ? undefined : ne(postTargets.postId, excludePostId),
            gte(when, weekBefore),
            lte(when, weekAfter),
          ),
        )
      for (const r of rows) {
        if (r.fingerprint !== null) {
          const set = facts.recentFingerprints.get(r.accountId) ?? new Set<string>()
          set.add(r.fingerprint)
          facts.recentFingerprints.set(r.accountId, set)
        }
        // the 24 hours before the instant, the instant included
        if (r.scheduledAt <= dayBefore || r.scheduledAt > at) continue
        facts.scheduledNear.set(r.accountId, (facts.scheduledNear.get(r.accountId) ?? 0) + 1)
        if (r.type === 'reel')
          facts.reelsLast24h.set(r.accountId, (facts.reelsLast24h.get(r.accountId) ?? 0) + 1)
      }
      return facts
    },
    async usingMedia(organizationId, mediaIds) {
      if (mediaIds.length === 0) return []
      const wanted = new Set(mediaIds)
      const ids = [...wanted]
      const rows = await db
        .select({
          mediaId: postMedia.mediaId,
          coverMediaId: postMedia.coverMediaId,
          postId: posts.id,
          status: posts.status,
          scheduledAt: posts.scheduledAt,
          timezone: posts.timezone,
          updatedAt: posts.updatedAt,
        })
        .from(postMedia)
        .innerJoin(
          posts,
          and(eq(posts.organizationId, postMedia.organizationId), eq(posts.id, postMedia.postId)),
        )
        .where(
          and(
            eq(postMedia.organizationId, organizationId),
            or(inArray(postMedia.mediaId, ids), inArray(postMedia.coverMediaId, ids)),
          ),
        )
        // the order of `compareUses` (D-80.7, plan 07 Scelta 5): going out by date, drafts by
        // their last change, gone out by date (the latest first), the rest by their last change,
        // then the id; the sort of the use case makes sure of it
        .orderBy(
          sql`case when ${posts.status} in ('scheduled', 'publishing', 'paused') then 0
                   when ${posts.status} = 'draft' then 1
                   when ${posts.status} in ('published', 'partial', 'problem') then 2
                   else 3 end`,
          sql`case when ${posts.status} in ('scheduled', 'publishing', 'paused')
                   then ${posts.scheduledAt} end asc nulls last`,
          sql`case when ${posts.status} in ('published', 'partial', 'problem')
                   then ${posts.scheduledAt} end desc nulls last`,
          sql`case when ${posts.status} = 'draft'
                     or ${posts.status} not in ('scheduled', 'publishing', 'paused', 'published',
                                                'partial', 'problem')
                   then ${posts.updatedAt} end desc nulls last`,
          asc(posts.id),
        )
      const uses = new Map<string, MediaUse & { mediaId: string }>()
      for (const r of rows)
        for (const mediaId of [r.mediaId, r.coverMediaId])
          if (mediaId !== null && wanted.has(mediaId))
            uses.set(`${mediaId}:${r.postId}`, {
              mediaId,
              postId: r.postId,
              status: r.status as PublishingPostStatus,
              scheduledAt: r.scheduledAt,
              timezone: r.timezone,
              updatedAt: r.updatedAt,
            })
      return [...uses.values()].sort(compareUses)
    },
    listNotes(scope, postId) {
      return db
        .select(noteColumns)
        .from(postNotes)
        .where(notesOf(scope, postId))
        .orderBy(asc(postNotes.createdAt), asc(postNotes.id))
    },
    async insertNote(scope, note) {
      const [row] = await db
        .insert(postNotes)
        .values({ ...scope, ...note })
        .returning(noteColumns)
      if (!row) throw new Error('the note was not written')
      return row
    },
    async findNote(scope, postId, noteId) {
      const [row] = await db
        .select(noteColumns)
        .from(postNotes)
        .where(and(notesOf(scope, postId), eq(postNotes.id, noteId)))
      return row ?? null
    },
    async deleteNote(scope, postId, noteId) {
      const rows = await db
        .delete(postNotes)
        .where(and(notesOf(scope, postId), eq(postNotes.id, noteId)))
        .returning({ id: postNotes.id })
      return rows.length > 0
    },
  }
}

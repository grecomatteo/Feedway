import { and, asc, desc, eq, gte, inArray, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm'
import type {
  IdGenerator,
  PostRecord,
  PostRepository,
  PostScope,
  PostTargetRecord,
} from '@app/application'
import type { Platform, PostCover, PostOptions, PostStatus, PostType } from '@app/domain'
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
        })),
      labelIds: labels.filter((l) => l.postId === row.id).map((l) => l.labelId),
    }
  })
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
        .values([...byAccount.values()].map((t) => ({ id: ids.newId(), ...scope, postId, ...t })))
        .onConflictDoUpdate({
          target: [postTargets.organizationId, postTargets.postId, postTargets.accountId],
          // never a row of another workspace's post: its key would not take this one
          setWhere: eq(postTargets.workspaceId, scope.workspaceId),
          set: {
            status: sql`excluded.status`,
            fingerprint: sql`excluded.fingerprint`,
            updatedAt: sql`now()`,
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
      const moved = await db
        .update(posts)
        .set({ status: 'draft', updatedBy, version: sql`${posts.version} + 1` })
        .where(and(inScope(scope), eq(posts.status, 'scheduled')))
        .returning({ id: posts.id })
      const postIds = moved.map((r) => r.id)
      if (postIds.length === 0) return []
      await db
        .update(postTargets)
        .set({ status: 'draft', fingerprint: null, updatedAt: sql`now()` })
        .where(
          and(
            eq(postTargets.organizationId, scope.organizationId),
            eq(postTargets.workspaceId, scope.workspaceId),
            inArray(postTargets.postId, postIds),
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
            eq(posts.status, 'scheduled'),
            gte(posts.scheduledAt, from),
            lt(posts.scheduledAt, to),
            excludePostId === undefined ? undefined : ne(posts.id, excludePostId),
          ),
        )
      return row?.n ?? 0
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
      const rows = await db
        .select({
          accountId: postTargets.accountId,
          fingerprint: postTargets.fingerprint,
          type: posts.type,
          scheduledAt: posts.scheduledAt,
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
            eq(postTargets.status, 'scheduled'),
            // as `countScheduled`: an archived client's posts never go out (D-70)
            sql`not exists (select 1 from workspaces w where w.organization_id = ${posts.organizationId}
                  and w.id = ${posts.workspaceId} and w.archived_at is not null)`,
            excludePostId === undefined ? undefined : ne(postTargets.postId, excludePostId),
            gte(posts.scheduledAt, weekBefore),
            lte(posts.scheduledAt, weekAfter),
          ),
        )
      for (const r of rows) {
        if (r.fingerprint !== null) {
          const set = facts.recentFingerprints.get(r.accountId) ?? new Set<string>()
          set.add(r.fingerprint)
          facts.recentFingerprints.set(r.accountId, set)
        }
        // the 24 hours before the instant, the instant included
        if (r.scheduledAt === null || r.scheduledAt <= dayBefore || r.scheduledAt > at) continue
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
      const uses = new Map<
        string,
        {
          mediaId: string
          postId: string
          status: PostStatus
          scheduledAt: Date | null
          timezone: string
        }
      >()
      for (const r of rows)
        for (const mediaId of [r.mediaId, r.coverMediaId])
          if (mediaId !== null && wanted.has(mediaId))
            uses.set(`${mediaId}:${r.postId}`, {
              mediaId,
              postId: r.postId,
              status: r.status as PostStatus,
              scheduledAt: r.scheduledAt,
              timezone: r.timezone,
            })
      return [...uses.values()].sort(
        (a, b) => Number(b.status === 'scheduled') - Number(a.status === 'scheduled'),
      )
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

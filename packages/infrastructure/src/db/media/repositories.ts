import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type {
  LibraryFolderRecord,
  MediaFacts,
  MediaFilter,
  MediaForRules,
  MediaRecord,
  MediaRepository,
  MediaVariantRecord,
  PublicVariantRecord,
  PublishCopyRecord,
} from '@app/application'
import type {
  FileAnalysis,
  MediaChecks,
  MediaFailure,
  MediaKind,
  MediaProgress,
  MediaStatus,
  VariantPurpose,
  VariantStatus,
} from '@app/domain'
import type { DbExecutor } from '../client.js'
import { libraryFolders, libraryItems, media, mediaVariants, uploadSessions } from './schema.js'

// Every query filters by organization in SQL as well: row level security is the second barrier.

const mediaColumns = {
  id: media.id,
  organizationId: media.organizationId,
  workspaceId: media.workspaceId,
  uploadedBy: media.uploadedBy,
  kind: media.kind,
  status: media.status,
  originalName: media.originalName,
  mime: media.mime,
  sizeBytes: media.sizeBytes,
  sha256: media.sha256,
  width: media.width,
  height: media.height,
  durationMs: media.durationMs,
  fps: media.fps,
  videoCodec: media.videoCodec,
  audioCodec: media.audioCodec,
  progress: media.progress,
  failure: media.failure,
  checks: media.checks,
  processingAttempts: media.processingAttempts,
  storageKey: media.storageKey,
  deletedAt: media.deletedAt,
  createdAt: media.createdAt,
  folderId: libraryItems.folderId,
  tags: libraryItems.tags,
  // the entry's own key: null when the file is not in the library
  libraryMediaId: libraryItems.mediaId,
}

type MediaRow = {
  kind: string
  status: string
  progress: unknown
  failure: unknown
  checks: unknown
  tags: string[] | null
  libraryMediaId: string | null
} & Omit<MediaRecord, 'kind' | 'status' | 'progress' | 'failure' | 'checks' | 'tags' | 'inLibrary'>

// the check constraints keep the values inside the lists
const copyColumns = {
  id: mediaVariants.id,
  mediaId: mediaVariants.mediaId,
  purpose: mediaVariants.purpose,
  recipe: mediaVariants.recipe,
  status: mediaVariants.status,
  failure: mediaVariants.failure,
  storageKey: mediaVariants.storageKey,
  publicToken: mediaVariants.publicToken,
  mime: mediaVariants.mime,
  sizeBytes: mediaVariants.sizeBytes,
  width: mediaVariants.width,
  height: mediaVariants.height,
}

const copyOf = (
  row: Omit<PublishCopyRecord, 'purpose' | 'status'> & { purpose: string; status: string },
): PublishCopyRecord => ({
  ...row,
  purpose: row.purpose as VariantPurpose,
  status: row.status as VariantStatus,
})

const copyPending = (organizationId: string, variantId: string) =>
  and(
    eq(mediaVariants.organizationId, organizationId),
    eq(mediaVariants.id, variantId),
    eq(mediaVariants.status, 'pending'),
  )

function mediaOf(row: MediaRow): MediaRecord {
  const { libraryMediaId, ...rest } = row
  return {
    ...rest,
    kind: row.kind as MediaKind,
    status: row.status as MediaStatus,
    progress: (row.progress ?? null) as MediaProgress | null,
    failure: (row.failure ?? null) as MediaFailure | null,
    checks: (row.checks ?? null) as MediaChecks | null,
    tags: row.tags ?? [],
    inLibrary: libraryMediaId !== null,
  }
}

const withLibrary = (db: DbExecutor) =>
  db
    .select(mediaColumns)
    .from(media)
    .leftJoin(
      libraryItems,
      and(
        eq(libraryItems.organizationId, media.organizationId),
        eq(libraryItems.mediaId, media.id),
      ),
    )

/** A unique index said no: two folders side by side with one name. */
function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: unknown; cause?: { code?: unknown } }
  return e.code === '23505' || e.cause?.code === '23505'
}

/** `%`, `_` and `\` taken literally in ILIKE. */
const likeLiteral = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`)

function filterOf(filter: MediaFilter | undefined): (SQL | undefined)[] {
  if (!filter) return []
  return [
    filter.kind === undefined ? undefined : eq(media.kind, filter.kind),
    filter.folder === undefined
      ? undefined
      : filter.folder === 'none'
        ? isNull(libraryItems.folderId)
        : eq(libraryItems.folderId, filter.folder),
    // `@>` uses the GIN index of the tags
    filter.tag === undefined
      ? undefined
      : sql`${libraryItems.tags} @> array[${filter.tag}]::text[]`,
    // «Cerca per nome o tag» (screen 19): a part of the name, or of one of its tags
    filter.name === undefined
      ? undefined
      : or(
          ilike(media.originalName, `%${likeLiteral(filter.name)}%`),
          sql`exists (select 1 from unnest(${libraryItems.tags}) as t(tag)
                where t.tag ilike ${`%${likeLiteral(filter.name.toLocaleLowerCase('it'))}%`})`,
        ),
    usedBy(filter.inPosts ? 'any' : filter.use),
  ]
}

// post_media belongs to the posts module: read here by its table, as the RLS allows
const inPostWith = (status: string | null) =>
  sql`exists (select 1 from post_media pm join posts p
        on p.organization_id = pm.organization_id and p.id = pm.post_id
      where pm.organization_id = ${media.organizationId}
        and (pm.media_id = ${media.id} or pm.cover_media_id = ${media.id})
        ${status === null ? sql`` : sql`and p.status = ${status}`})`

/** The filter with every kind: the counts of «Tutti · Foto · Video». */
function withoutKind(filter: MediaFilter): MediaFilter {
  const rest = { ...filter }
  delete rest.kind
  return rest
}

/**
 * The filter by use (screen 19), on the same order as `primaryUse` (D-80.7): «in una bozza» is a
 * file whose use that counts is a draft, so never a file of a scheduled post.
 */
function usedBy(use: MediaFilter['use']): SQL | undefined {
  switch (use) {
    case 'any':
      return inPostWith(null)
    case 'scheduled':
      return inPostWith('scheduled')
    case 'draft':
      return sql`(${inPostWith('draft')} and not ${inPostWith('scheduled')})`
    case 'unused':
      return sql`not ${inPostWith(null)}`
    default:
      return undefined
  }
}

const factsColumns = (facts: MediaFacts) => ({
  analysis: facts.analysis,
  width: facts.width,
  height: facts.height,
  durationMs: facts.durationMs,
  fps: facts.fps,
  videoCodec: facts.videoCodec,
  audioCodec: facts.audioCodec,
})

export function drizzleMedia(db: DbExecutor): MediaRepository {
  const stillProcessing = (organizationId: string, mediaId: string) =>
    and(
      eq(media.organizationId, organizationId),
      eq(media.id, mediaId),
      eq(media.status, 'processing'),
    )
  /** The files of these workspaces, newest first, a page after `before`. */
  async function listFor(
    organizationId: string,
    workspaceIds: readonly string[],
    page: { before?: string; limit: number; filter?: MediaFilter },
  ) {
    if (workspaceIds.length === 0) return []
    const rows = await withLibrary(db)
      .where(
        and(
          eq(media.organizationId, organizationId),
          inArray(media.workspaceId, [...workspaceIds]),
          ne(media.status, 'deleted'),
          ...filterOf(page.filter),
          page.before === undefined
            ? undefined
            : sql`(${media.createdAt}, ${media.id}) < (select b.created_at, b.id from ${media} b
                   where b.organization_id = ${organizationId} and b.id = ${page.before})`,
        ),
      )
      .orderBy(desc(media.createdAt), desc(media.id))
      .limit(page.limit)
    return rows.map(mediaOf)
  }

  return {
    async create(record) {
      const { folderId, ...row } = record
      await db.insert(media).values(row)
      await db.insert(libraryItems).values({
        organizationId: record.organizationId,
        workspaceId: record.workspaceId,
        mediaId: record.id,
        folderId,
      })
    },
    async hasFiles(organizationId, workspaceId) {
      const [row] = await db
        .select({ id: media.id })
        .from(media)
        .where(
          and(
            eq(media.organizationId, organizationId),
            eq(media.workspaceId, workspaceId),
            ne(media.status, 'deleted'),
          ),
        )
        .limit(1)
      return row !== undefined
    },
    async folderExists(organizationId, workspaceId, folderId) {
      const [row] = await db
        .select({ id: libraryFolders.id })
        .from(libraryFolders)
        .where(
          and(
            eq(libraryFolders.organizationId, organizationId),
            eq(libraryFolders.workspaceId, workspaceId),
            eq(libraryFolders.id, folderId),
          ),
        )
      return row !== undefined
    },
    async deletedWithFiles(organizationId) {
      const rows = await db
        .select({ id: media.id })
        .from(media)
        .where(
          and(
            eq(media.organizationId, organizationId),
            eq(media.status, 'deleted'),
            sql`(${media.storageKey} is not null or exists (
                  select 1 from ${mediaVariants} v
                   where v.organization_id = ${media.organizationId} and v.media_id = ${media.id}))`,
          ),
        )
        .orderBy(media.createdAt, media.id)
      return rows.map((r) => r.id)
    },
    async processingSince(organizationId, before) {
      const rows = await db
        .select({ id: media.id })
        .from(media)
        .where(
          and(
            eq(media.organizationId, organizationId),
            eq(media.status, 'processing'),
            lt(media.updatedAt, before),
          ),
        )
        .orderBy(media.createdAt, media.id)
      return rows.map((r) => r.id)
    },
    async sameContent(organizationId, workspaceId, sha256, exceptId) {
      const [row] = await db
        .select({ id: media.id, originalName: media.originalName })
        .from(media)
        .where(
          and(
            eq(media.organizationId, organizationId),
            eq(media.workspaceId, workspaceId),
            eq(media.sha256, sha256),
            ne(media.status, 'deleted'),
            ne(media.id, exceptId),
          ),
        )
        .orderBy(media.createdAt, media.id)
        .limit(1)
      return row ?? null
    },
    async listFailed(organizationId, workspaceIds, limit) {
      if (workspaceIds.length === 0) return []
      const rows = await db
        .select({
          id: media.id,
          workspaceId: media.workspaceId,
          originalName: media.originalName,
          failure: media.failure,
          storageKey: media.storageKey,
          failedAt: media.updatedAt,
        })
        .from(media)
        .where(
          and(
            eq(media.organizationId, organizationId),
            inArray(media.workspaceId, [...workspaceIds]),
            eq(media.status, 'failed'),
          ),
        )
        .orderBy(desc(media.updatedAt), desc(media.id))
        .limit(limit)
      return rows.map(({ storageKey, failure, ...row }) => ({
        ...row,
        failure: failure as MediaFailure | null,
        hasOriginal: storageKey !== null,
      }))
    },
    async failedSince(organizationId, before) {
      return db
        .select({ id: media.id, workspaceId: media.workspaceId })
        .from(media)
        .where(
          and(
            eq(media.organizationId, organizationId),
            eq(media.status, 'failed'),
            lt(media.updatedAt, before),
          ),
        )
        .orderBy(media.createdAt, media.id)
    },
    async nextToProcess() {
      // the agencies with a file waiting, the one served least recently first (never served:
      // before any), then its oldest file; runs in the system scope, ids only
      const result = await db.execute<{ organization_id: string; id: string }>(sql`
        with waiting as (
          select distinct organization_id from ${media} where status = 'processing'
        ), turns as (
          select w.organization_id,
                 (select max(m.processing_started_at) from ${media} m
                   where m.organization_id = w.organization_id) as served_at
            from waiting w
        )
        select t.organization_id, f.id
          from turns t
          cross join lateral (
            select m.id from ${media} m
             where m.organization_id = t.organization_id and m.status = 'processing'
             order by m.created_at, m.id
             limit 1
          ) f
         order by t.served_at asc nulls first, t.organization_id
         limit 1`)
      const [row] = result.rows
      return row ? { organizationId: row.organization_id, mediaId: row.id } : null
    },
    async claimProcessing(organizationId, mediaId, at) {
      const claimed = await db
        .update(media)
        .set({
          processingAttempts: sql`${media.processingAttempts} + 1`,
          processingStartedAt: at,
          progress: { step: 'analysis', percent: 0 },
        })
        .where(stillProcessing(organizationId, mediaId))
        .returning({ id: media.id })
      if (claimed.length === 0) return null
      const [row] = await withLibrary(db).where(
        and(eq(media.organizationId, organizationId), eq(media.id, mediaId)),
      )
      return row ? mediaOf(row) : null
    },
    async releaseAttempt(organizationId, mediaId) {
      await db
        .update(media)
        .set({ processingAttempts: sql`greatest(${media.processingAttempts} - 1, 0)` })
        .where(stillProcessing(organizationId, mediaId))
    },
    async saveVariant(organizationId, mediaId, variant) {
      const { id, recipe = '', ...rest } = variant
      await db
        .insert(mediaVariants)
        .values({ id, organizationId, mediaId, recipe, ...rest, status: 'ready', failure: null })
        .onConflictDoUpdate({
          target: [
            mediaVariants.organizationId,
            mediaVariants.mediaId,
            mediaVariants.purpose,
            mediaVariants.recipe,
          ],
          set: {
            // a copy made again is another copy: its id is the ETag the browsers and Meta keep
            id,
            storageKey: rest.storageKey,
            publicToken: rest.publicToken,
            mime: rest.mime,
            sizeBytes: rest.sizeBytes,
            width: rest.width,
            height: rest.height,
            status: 'ready',
            failure: null,
          },
        })
    },
    async requestCopies(organizationId, copies) {
      if (copies.length === 0) return 0
      const rows = await db
        .insert(mediaVariants)
        .values(
          copies.map((c) => ({
            ...c,
            organizationId,
            sizeBytes: 0,
            status: 'pending',
            failure: null,
            attempts: 0,
          })),
        )
        .onConflictDoUpdate({
          target: [
            mediaVariants.organizationId,
            mediaVariants.mediaId,
            mediaVariants.purpose,
            mediaVariants.recipe,
          ],
          // only a copy that could not be made is tried again; the others stay as they are
          set: { status: 'pending', failure: null, attempts: 0 },
          setWhere: sql`${mediaVariants.status} = 'failed'`,
        })
        .returning({ id: mediaVariants.id })
      return rows.length
    },
    async copiesOf(organizationId, mediaIds) {
      if (mediaIds.length === 0) return []
      const rows = await db
        .select(copyColumns)
        .from(mediaVariants)
        .where(
          and(
            eq(mediaVariants.organizationId, organizationId),
            inArray(mediaVariants.mediaId, [...mediaIds]),
          ),
        )
        .orderBy(mediaVariants.mediaId, mediaVariants.purpose, mediaVariants.recipe)
      return rows.map(copyOf)
    },
    async nextCopyToMake() {
      // as `nextToProcess`: the agency served least recently, then its oldest copy; ids only
      const result = await db.execute<{ organization_id: string; id: string }>(sql`
        with waiting as (
          select distinct organization_id from ${mediaVariants} where status = 'pending'
        ), turns as (
          select w.organization_id,
                 (select max(v.started_at) from ${mediaVariants} v
                   where v.organization_id = w.organization_id) as served_at
            from waiting w
        )
        select t.organization_id, c.id
          from turns t
          cross join lateral (
            select v.id from ${mediaVariants} v
             where v.organization_id = t.organization_id and v.status = 'pending'
             order by v.created_at, v.id
             limit 1
          ) c
         order by t.served_at asc nulls first, t.organization_id
         limit 1`)
      const [row] = result.rows
      return row ? { organizationId: row.organization_id, variantId: row.id } : null
    },
    async claimCopy(organizationId, variantId, at) {
      const [row] = await db
        .update(mediaVariants)
        .set({ attempts: sql`${mediaVariants.attempts} + 1`, startedAt: at })
        .where(copyPending(organizationId, variantId))
        .returning({ ...copyColumns, attempts: mediaVariants.attempts })
      return row ? { ...copyOf(row), attempts: row.attempts } : null
    },
    async releaseCopyAttempt(organizationId, variantId) {
      await db
        .update(mediaVariants)
        .set({ attempts: sql`greatest(${mediaVariants.attempts} - 1, 0)` })
        .where(copyPending(organizationId, variantId))
    },
    async finishCopy(organizationId, variantId, made) {
      const rows = await db
        .update(mediaVariants)
        .set({ ...made, status: 'ready', failure: null })
        .where(copyPending(organizationId, variantId))
        .returning({ id: mediaVariants.id })
      return rows.length > 0
    },
    async failCopy(organizationId, variantId, failure) {
      const rows = await db
        .update(mediaVariants)
        .set({ status: 'failed', failure })
        .where(copyPending(organizationId, variantId))
        .returning({ id: mediaVariants.id })
      return rows.length > 0
    },
    async dropVariants(organizationId, mediaId) {
      const rows = await db
        .delete(mediaVariants)
        .where(
          and(eq(mediaVariants.organizationId, organizationId), eq(mediaVariants.mediaId, mediaId)),
        )
        .returning({ key: mediaVariants.storageKey })
      return rows.map((r) => r.key)
    },
    async recipeCopiesBefore(organizationId, createdBefore) {
      const rows = await db
        .select(copyColumns)
        .from(mediaVariants)
        .where(
          and(
            eq(mediaVariants.organizationId, organizationId),
            ne(mediaVariants.recipe, ''),
            lt(mediaVariants.createdAt, createdBefore),
          ),
        )
        .orderBy(mediaVariants.mediaId, mediaVariants.purpose, mediaVariants.recipe)
      return rows.map(copyOf)
    },
    async dropCopies(organizationId, ids) {
      if (ids.length === 0) return []
      const rows = await db
        .delete(mediaVariants)
        .where(
          and(
            eq(mediaVariants.organizationId, organizationId),
            inArray(mediaVariants.id, [...ids]),
            // never a copy made with its file: only those of a post
            ne(mediaVariants.recipe, ''),
          ),
        )
        .returning({ key: mediaVariants.storageKey })
      return rows.map((r) => r.key)
    },
    async markReady(organizationId, mediaId, ready) {
      const rows = await db
        .update(media)
        .set({
          ...factsColumns(ready),
          status: 'ready',
          checks: ready.checks,
          progress: { step: 'ready', percent: 100 },
          ...(ready.forgetOriginal && { storageKey: null }),
        })
        .where(stillProcessing(organizationId, mediaId))
        .returning({ id: media.id })
      return rows.length > 0
    },
    async markFailed(organizationId, mediaId, failed) {
      const rows = await db
        .update(media)
        .set({
          ...(failed.facts && factsColumns(failed.facts)),
          status: 'failed',
          failure: failed.failure,
          progress: null,
          ...(failed.forgetOriginal && { storageKey: null }),
        })
        .where(stillProcessing(organizationId, mediaId))
        .returning({ id: media.id })
      return rows.length > 0
    },
    async markRetried(organizationId, mediaId) {
      const rows = await db
        .update(media)
        .set({ status: 'processing', failure: null, progress: null, processingAttempts: 0 })
        .where(
          and(
            eq(media.organizationId, organizationId),
            eq(media.id, mediaId),
            eq(media.status, 'failed'),
            isNotNull(media.storageKey),
          ),
        )
        .returning({ id: media.id })
      return rows.length > 0
    },
    async setProgress(organizationId, mediaId, progress) {
      const rows = await db
        .update(media)
        .set({ progress })
        .where(
          and(
            eq(media.organizationId, organizationId),
            eq(media.id, mediaId),
            eq(media.status, 'processing'),
          ),
        )
        .returning({ id: media.id })
      return rows.length > 0
    },
    listForWorkspace(organizationId, workspaceId, page) {
      return listFor(organizationId, [workspaceId], page)
    },
    listForWorkspaces(organizationId, workspaceIds, page) {
      return listFor(organizationId, workspaceIds, page)
    },
    async countByKind(organizationId, workspaceIds, filter) {
      const counts = { image: 0, video: 0 }
      if (workspaceIds.length === 0) return counts
      const rows = await db
        .select({ kind: media.kind, n: sql<number>`count(*)::int` })
        .from(media)
        .leftJoin(
          libraryItems,
          and(
            eq(libraryItems.organizationId, media.organizationId),
            eq(libraryItems.mediaId, media.id),
          ),
        )
        .where(
          and(
            eq(media.organizationId, organizationId),
            inArray(media.workspaceId, [...workspaceIds]),
            ne(media.status, 'deleted'),
            ...filterOf(withoutKind(filter)),
          ),
        )
        .groupBy(media.kind)
      for (const r of rows) if (r.kind === 'image' || r.kind === 'video') counts[r.kind] = r.n
      return counts
    },
    async tagsOf(organizationId, workspaceId) {
      const result = await db.execute<{ tag: string }>(sql`
        select distinct t.tag
          from ${libraryItems} i
          join ${media} m on m.organization_id = i.organization_id and m.id = i.media_id
          cross join lateral unnest(i.tags) as t(tag)
         where i.organization_id = ${organizationId} and i.workspace_id = ${workspaceId}
           and m.status <> 'deleted'
         order by t.tag`)
      return result.rows.map((r) => r.tag)
    },
    async setLibraryEntry(organizationId, workspaceId, mediaId, entry) {
      const change = {
        ...(entry.folderId === undefined ? {} : { folderId: entry.folderId }),
        ...(entry.tags === undefined ? {} : { tags: entry.tags }),
      }
      await db
        .insert(libraryItems)
        .values({ organizationId, workspaceId, mediaId, ...change })
        .onConflictDoUpdate({
          target: [libraryItems.organizationId, libraryItems.mediaId],
          set: { ...change, updatedAt: new Date() },
        })
    },
    async lockFolders(organizationId, workspaceId) {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`library_folders:${organizationId}:${workspaceId}`}))`,
      )
    },
    async listFolders(organizationId, workspaceId): Promise<LibraryFolderRecord[]> {
      const rows = await db
        .select({
          id: libraryFolders.id,
          parentId: libraryFolders.parentId,
          name: libraryFolders.name,
          createdAt: libraryFolders.createdAt,
          fileCount: sql<number>`(select count(*)::int from ${libraryItems} i
             join ${media} m on m.organization_id = i.organization_id and m.id = i.media_id
            where i.organization_id = "library_folders"."organization_id"
              and i.folder_id = "library_folders"."id" and m.status <> 'deleted')`,
        })
        .from(libraryFolders)
        .where(
          and(
            eq(libraryFolders.organizationId, organizationId),
            eq(libraryFolders.workspaceId, workspaceId),
          ),
        )
        .orderBy(asc(sql`lower(${libraryFolders.name})`), asc(libraryFolders.id))
      return rows
    },
    async createFolder(folder) {
      try {
        await db.transaction((sp) => sp.insert(libraryFolders).values(folder))
      } catch (error) {
        if (isUniqueViolation(error)) return 'taken'
        throw error
      }
      return 'created'
    },
    async updateFolder(organizationId, workspaceId, folderId, change) {
      try {
        const rows = await db.transaction((sp) =>
          sp
            .update(libraryFolders)
            .set({ ...change, updatedAt: new Date() })
            .where(
              and(
                eq(libraryFolders.organizationId, organizationId),
                eq(libraryFolders.workspaceId, workspaceId),
                eq(libraryFolders.id, folderId),
              ),
            )
            .returning({ id: libraryFolders.id }),
        )
        return rows.length === 0 ? 'missing' : 'updated'
      } catch (error) {
        if (isUniqueViolation(error)) return 'taken'
        throw error
      }
    },
    async mediaInFolders(organizationId, workspaceId, folderIds) {
      if (folderIds.length === 0) return []
      const rows = await db
        .select({ mediaId: libraryItems.mediaId, folderId: libraryItems.folderId })
        .from(libraryItems)
        .where(
          and(
            eq(libraryItems.organizationId, organizationId),
            eq(libraryItems.workspaceId, workspaceId),
            inArray(libraryItems.folderId, [...folderIds]),
          ),
        )
      return rows.flatMap((r) => (r.folderId === null ? [] : [{ ...r, folderId: r.folderId }]))
    },
    async deleteFolders(organizationId, workspaceId, folderIds) {
      if (folderIds.length === 0) return
      const ids = [...folderIds]
      await db
        .update(uploadSessions)
        .set({ folderId: null })
        .where(
          and(
            eq(uploadSessions.organizationId, organizationId),
            eq(uploadSessions.workspaceId, workspaceId),
            inArray(uploadSessions.folderId, ids),
          ),
        )
      // one statement: the parent key is checked at its end, so a folder and its subfolders go together
      await db
        .delete(libraryFolders)
        .where(
          and(
            eq(libraryFolders.organizationId, organizationId),
            eq(libraryFolders.workspaceId, workspaceId),
            inArray(libraryFolders.id, ids),
          ),
        )
    },
    async forRules(organizationId, workspaceId, mediaIds): Promise<MediaForRules[]> {
      if (mediaIds.length === 0) return []
      const rows = await db
        .select({
          id: media.id,
          kind: media.kind,
          status: media.status,
          analysis: media.analysis,
          checks: media.checks,
          failure: media.failure,
          sha256: media.sha256,
        })
        .from(media)
        .where(
          and(
            eq(media.organizationId, organizationId),
            eq(media.workspaceId, workspaceId),
            inArray(media.id, [...mediaIds]),
          ),
        )
      // the check constraints keep kind and status inside their lists; the worker wrote the rest
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind as MediaKind,
        status: r.status as MediaStatus,
        analysis: (r.analysis ?? null) as FileAnalysis | null,
        checks: (r.checks ?? null) as MediaChecks | null,
        failure: (r.failure ?? null) as MediaFailure | null,
        sha256: r.sha256,
      }))
    },
    async findManyInWorkspace(organizationId, workspaceId, mediaIds) {
      if (mediaIds.length === 0) return []
      const rows = await withLibrary(db).where(
        and(
          eq(media.organizationId, organizationId),
          eq(media.workspaceId, workspaceId),
          inArray(media.id, [...mediaIds]),
        ),
      )
      return rows.map(mediaOf)
    },
    async findById(organizationId, mediaId) {
      const [row] = await withLibrary(db).where(
        and(eq(media.organizationId, organizationId), eq(media.id, mediaId)),
      )
      return row ? mediaOf(row) : null
    },
    async findPublicVariant(token): Promise<PublicVariantRecord | null> {
      // across the agencies (system scope): the token alone names the copy
      const [row] = await db
        .select({
          id: mediaVariants.id,
          organizationId: mediaVariants.organizationId,
          storageKey: mediaVariants.storageKey,
          mime: mediaVariants.mime,
          sizeBytes: mediaVariants.sizeBytes,
        })
        .from(mediaVariants)
        .innerJoin(
          media,
          and(
            eq(media.organizationId, mediaVariants.organizationId),
            eq(media.id, mediaVariants.mediaId),
          ),
        )
        .where(
          and(
            eq(mediaVariants.publicToken, token),
            eq(media.status, 'ready'),
            // a copy to publish still being made, or that could not be, has no file to serve
            eq(mediaVariants.status, 'ready'),
            // only the copies made to be published: never the panel's own (`preview`,
            // `thumbnail`, §11.1 point 7), nor a purpose added later, even with a token
            inArray(mediaVariants.purpose, ['ig_feed', 'fb_photo', 'reel', 'story', 'cover']),
          ),
        )
        .limit(1)
      return row ?? null
    },
    async variantsOf(organizationId, mediaIds) {
      if (mediaIds.length === 0) return []
      const rows = await db
        .select({
          id: mediaVariants.id,
          mediaId: mediaVariants.mediaId,
          purpose: mediaVariants.purpose,
          storageKey: mediaVariants.storageKey,
          mime: mediaVariants.mime,
          sizeBytes: mediaVariants.sizeBytes,
          width: mediaVariants.width,
          height: mediaVariants.height,
        })
        .from(mediaVariants)
        .where(
          and(
            eq(mediaVariants.organizationId, organizationId),
            inArray(mediaVariants.mediaId, [...mediaIds]),
            eq(mediaVariants.recipe, ''),
          ),
        )
        .orderBy(mediaVariants.mediaId, mediaVariants.purpose)
      return rows.map((r): MediaVariantRecord => ({ ...r, purpose: r.purpose as VariantPurpose }))
    },
    async markDeleted(organizationId, workspaceId, mediaId, at, failedBefore) {
      const marked = await db
        .update(media)
        .set({ status: 'deleted', deletedAt: at })
        .where(
          and(
            eq(media.organizationId, organizationId),
            eq(media.workspaceId, workspaceId),
            eq(media.id, mediaId),
            ne(media.status, 'deleted'),
            ...(failedBefore
              ? [eq(media.status, 'failed'), lt(media.updatedAt, failedBefore)]
              : []),
          ),
        )
        .returning({ id: media.id })
      if (marked.length === 0) return false
      await db
        .delete(libraryItems)
        .where(
          and(eq(libraryItems.organizationId, organizationId), eq(libraryItems.mediaId, mediaId)),
        )
      return true
    },
    async forgetFiles(organizationId, mediaId) {
      await db
        .delete(mediaVariants)
        .where(
          and(eq(mediaVariants.organizationId, organizationId), eq(mediaVariants.mediaId, mediaId)),
        )
      await db
        .update(media)
        .set({ storageKey: null })
        .where(and(eq(media.organizationId, organizationId), eq(media.id, mediaId)))
    },
    async storageUsed(organizationId, workspaceId) {
      // an original still stored counts with its copies, whatever the file's status: what a
      // deleted file keeps until its job runs is still on disk
      const result = await db.execute<{ organization: string; workspace: string }>(sql`
        with files as (
          select m.workspace_id, m.size_bytes as bytes
            from ${media} m
           where m.organization_id = ${organizationId} and m.storage_key is not null
          union all
          select m.workspace_id, v.size_bytes
            from ${mediaVariants} v
            join ${media} m on m.organization_id = v.organization_id and m.id = v.media_id
           where v.organization_id = ${organizationId}
        )
        select coalesce(sum(bytes), 0)::text as organization,
               coalesce(sum(bytes) filter (where workspace_id = ${workspaceId}), 0)::text as workspace
          from files`)
      const [row] = result.rows
      return {
        organization: Number(row?.organization ?? 0),
        workspace: Number(row?.workspace ?? 0),
      }
    },
  }
}

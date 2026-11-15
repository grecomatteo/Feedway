import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { MediaRecord, MediaRepository, MediaVariantRecord } from '@app/application'
import type { MediaKind, MediaProgress, MediaStatus, VariantPurpose } from '@app/domain'
import type { DbExecutor } from '../client.js'
import { libraryFolders, libraryItems, media, mediaVariants } from './schema.js'

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
  tags: string[] | null
  libraryMediaId: string | null
} & Omit<MediaRecord, 'kind' | 'status' | 'progress' | 'tags' | 'inLibrary'>

// the check constraints keep the values inside the lists
function mediaOf(row: MediaRow): MediaRecord {
  const { libraryMediaId, ...rest } = row
  return {
    ...rest,
    kind: row.kind as MediaKind,
    status: row.status as MediaStatus,
    progress: (row.progress ?? null) as MediaProgress | null,
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

export function drizzleMedia(db: DbExecutor): MediaRepository {
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
    async listForWorkspace(organizationId, workspaceId, page) {
      const rows = await withLibrary(db)
        .where(
          and(
            eq(media.organizationId, organizationId),
            eq(media.workspaceId, workspaceId),
            ne(media.status, 'deleted'),
            page.before === undefined
              ? undefined
              : sql`(${media.createdAt}, ${media.id}) < (select b.created_at, b.id from ${media} b
                     where b.organization_id = ${organizationId} and b.id = ${page.before})`,
          ),
        )
        .orderBy(desc(media.createdAt), desc(media.id))
        .limit(page.limit)
      return rows.map(mediaOf)
    },
    async findById(organizationId, mediaId) {
      const [row] = await withLibrary(db).where(
        and(eq(media.organizationId, organizationId), eq(media.id, mediaId)),
      )
      return row ? mediaOf(row) : null
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
          ),
        )
        .orderBy(mediaVariants.mediaId, mediaVariants.purpose)
      return rows.map((r): MediaVariantRecord => ({ ...r, purpose: r.purpose as VariantPurpose }))
    },
    async markDeleted(organizationId, workspaceId, mediaId, at) {
      const marked = await db
        .update(media)
        .set({ status: 'deleted', deletedAt: at })
        .where(
          and(
            eq(media.organizationId, organizationId),
            eq(media.workspaceId, workspaceId),
            eq(media.id, mediaId),
            ne(media.status, 'deleted'),
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

import { and, asc, eq, gt, isNull, lte, sql } from 'drizzle-orm'
import type { UploadSessionRecord, UploadSessionsRepository } from '@app/application'
import type { DbExecutor } from '../client.js'
import { uploadSessions } from './schema.js'

// Every query filters by organization in SQL as well: row level security is the second barrier.

const columns = {
  id: uploadSessions.id,
  organizationId: uploadSessions.organizationId,
  workspaceId: uploadSessions.workspaceId,
  userId: uploadSessions.userId,
  folderId: uploadSessions.folderId,
  originalName: uploadSessions.originalName,
  mime: uploadSessions.mime,
  sizeBytes: uploadSessions.sizeBytes,
  firstPartSha256: uploadSessions.firstPartSha256,
  parts: uploadSessions.parts,
  expiresAt: uploadSessions.expiresAt,
  completedAt: uploadSessions.completedAt,
  mediaId: uploadSessions.mediaId,
  createdAt: uploadSessions.createdAt,
}

type Row = Omit<UploadSessionRecord, 'parts'> & { parts: unknown }

const recordOf = (row: Row): UploadSessionRecord => ({
  ...row,
  parts: (row.parts ?? {}) as Record<string, string>,
})

export function drizzleUploadSessions(db: DbExecutor): UploadSessionsRepository {
  const one = (organizationId: string, uploadId: string) =>
    and(eq(uploadSessions.organizationId, organizationId), eq(uploadSessions.id, uploadId))
  return {
    async create(record) {
      const [row] = await db.insert(uploadSessions).values(record).returning(columns)
      if (!row) throw new Error('upload session not written')
      return recordOf(row)
    },
    async findById(organizationId, uploadId, opts = {}) {
      const query = db.select(columns).from(uploadSessions).where(one(organizationId, uploadId))
      const [row] = await (opts.forUpdate ? query.for('update') : query)
      return row ? recordOf(row) : null
    },
    async listOpen(organizationId, workspaceId, userId, now) {
      const rows = await db
        .select(columns)
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.organizationId, organizationId),
            eq(uploadSessions.workspaceId, workspaceId),
            eq(uploadSessions.userId, userId),
            isNull(uploadSessions.completedAt),
            gt(uploadSessions.expiresAt, now),
          ),
        )
        .orderBy(asc(uploadSessions.createdAt), asc(uploadSessions.id))
      return rows.map(recordOf)
    },
    async recordPart(organizationId, uploadId, n, sha256) {
      await db
        .update(uploadSessions)
        .set({
          parts: sql`${uploadSessions.parts} || jsonb_build_object(${String(n)}::text, ${sha256}::text)`,
        })
        .where(one(organizationId, uploadId))
    },
    async complete(organizationId, uploadId, mediaId, at) {
      await db
        .update(uploadSessions)
        .set({ completedAt: at, mediaId })
        .where(one(organizationId, uploadId))
    },
    async delete(organizationId, uploadId) {
      await db.delete(uploadSessions).where(one(organizationId, uploadId))
    },
    async reservedBytes(organizationId, workspaceId, now) {
      const [row] = await db
        .select({
          organization: sql<string>`coalesce(sum(${uploadSessions.sizeBytes}), 0)::text`,
          workspace: sql<string>`coalesce(sum(${uploadSessions.sizeBytes}) filter (where ${uploadSessions.workspaceId} = ${workspaceId}), 0)::text`,
        })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.organizationId, organizationId),
            isNull(uploadSessions.completedAt),
            gt(uploadSessions.expiresAt, now),
          ),
        )
      return {
        organization: Number(row?.organization ?? 0),
        workspace: Number(row?.workspace ?? 0),
      }
    },
    async lockReservations(organizationId) {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`upload_sessions:${organizationId}`}))`,
      )
    },
    async deleteExpired(organizationId, now) {
      const rows = await db
        .delete(uploadSessions)
        .where(
          and(
            eq(uploadSessions.organizationId, organizationId),
            lte(uploadSessions.expiresAt, now),
          ),
        )
        .returning({ id: uploadSessions.id })
      return rows.map((r) => r.id)
    },
    async listIds(organizationId) {
      const rows = await db
        .select({ id: uploadSessions.id })
        .from(uploadSessions)
        .where(eq(uploadSessions.organizationId, organizationId))
      return rows.map((r) => r.id)
    },
  }
}

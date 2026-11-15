import { MEDIA_KINDS, MEDIA_STATUSES, PUBLIC_TOKEN_LENGTH, VARIANT_PURPOSES } from '@app/domain'
import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, inList, tz, updatedAt } from '../columns.js'
import { organizationMembers, organizations } from '../organizations/schema.js'
import { workspaces } from '../workspaces/schema.js'

// The media module (spec §13, plan 04 Task 8): every table carries the agency, and the
// composite keys keep a file, its folder and its library entry inside one workspace.

const bytes = (name: string) => bigint(name, { mode: 'number' })

/** A file of a workspace, as uploaded; its copies are `media_variants`. */
export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    workspaceId: uuid('workspace_id').notNull(),
    // information only: the file stays when that person leaves the agency
    uploadedBy: uuid('uploaded_by').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('uploading'),
    // shown only, never part of a path (§15.4)
    originalName: text('original_name').notNull(),
    // read from the bytes
    mime: text('mime').notNull(),
    sizeBytes: bytes('size_bytes').notNull(),
    // hex sha256 of the whole file, null until the upload is complete
    sha256: text('sha256'),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    fps: doublePrecision('fps'),
    videoCodec: text('video_codec'),
    audioCodec: text('audio_codec'),
    analysis: jsonb('analysis'),
    // the worker's step and percentage (plan 04 M4)
    progress: jsonb('progress'),
    // the original file; null once removed (a photo's, as soon as its variant is ready)
    storageKey: text('storage_key'),
    deletedAt: tz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // targets of the composite foreign keys
    unique('media_organization_id').on(t.organizationId, t.id),
    unique('media_workspace_id').on(t.organizationId, t.workspaceId, t.id),
    // the library, newest first
    index('media_workspace_created_idx').on(t.organizationId, t.workspaceId, t.createdAt, t.id),
    foreignKey({
      name: 'media_workspace_fk',
      columns: [t.organizationId, t.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }),
    check('media_kind', inList('kind', MEDIA_KINDS)),
    check('media_status', inList('status', MEDIA_STATUSES)),
    check('media_deleted', sql`(${t.status} = 'deleted') = (${t.deletedAt} is not null)`),
    check('media_size', sql`${t.sizeBytes} >= 0`),
    check('media_sha256', sql`${t.sha256} is null or ${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('media_original_name', sql`char_length(${t.originalName}) between 1 and 255`),
  ],
)

/** A copy of a file made by the worker: one per purpose. */
export const mediaVariants = pgTable(
  'media_variants',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    mediaId: uuid('media_id').notNull(),
    purpose: text('purpose').notNull(),
    storageKey: text('storage_key').notNull(),
    // the address on the public host (§16.1); never for the panel's own preview
    publicToken: text('public_token'),
    mime: text('mime').notNull(),
    sizeBytes: bytes('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('media_variants_one_per_purpose').on(t.organizationId, t.mediaId, t.purpose),
    unique('media_variants_token_unique').on(t.publicToken),
    foreignKey({
      name: 'media_variants_media_fk',
      columns: [t.organizationId, t.mediaId],
      foreignColumns: [media.organizationId, media.id],
    }).onDelete('cascade'),
    check('media_variants_purpose', inList('purpose', VARIANT_PURPOSES)),
    check(
      'media_variants_preview_private',
      sql`${t.purpose} <> 'preview' or ${t.publicToken} is null`,
    ),
    check(
      'media_variants_public_token',
      sql.raw(
        `public_token is null or public_token ~ '^[A-Za-z0-9_-]{${String(PUBLIC_TOKEN_LENGTH)}}$'`,
      ),
    ),
    check('media_variants_size', sql`${t.sizeBytes} >= 0`),
  ],
)

/** A folder of a workspace's library (§11.8). */
export const libraryFolders = pgTable(
  'library_folders',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    workspaceId: uuid('workspace_id').notNull(),
    name: text('name').notNull(),
    // null: at the top of the library
    parentId: uuid('parent_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('library_folders_workspace_id').on(t.organizationId, t.workspaceId, t.id),
    foreignKey({
      name: 'library_folders_workspace_fk',
      columns: [t.organizationId, t.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }),
    // the parent is a folder of the same workspace
    foreignKey({
      name: 'library_folders_parent_fk',
      columns: [t.organizationId, t.workspaceId, t.parentId],
      foreignColumns: [t.organizationId, t.workspaceId, t.id],
    }),
    check('library_folders_name', sql`char_length(${t.name}) between 1 and 80`),
    check('library_folders_not_own_parent', sql`${t.parentId} is distinct from ${t.id}`),
  ],
)

/** A file saved in the library: kept for reuse after publication (§11.8, §11.9). */
export const libraryItems = pgTable(
  'library_items',
  {
    organizationId: uuid('organization_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    mediaId: uuid('media_id').notNull(),
    // null: at the top of the library
    folderId: uuid('folder_id'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.mediaId] }),
    index('library_items_folder_idx').on(t.organizationId, t.workspaceId, t.folderId),
    // the file and the folder are of the same workspace
    foreignKey({
      name: 'library_items_media_fk',
      columns: [t.organizationId, t.workspaceId, t.mediaId],
      foreignColumns: [media.organizationId, media.workspaceId, media.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'library_items_folder_fk',
      columns: [t.organizationId, t.workspaceId, t.folderId],
      foreignColumns: [
        libraryFolders.organizationId,
        libraryFolders.workspaceId,
        libraryFolders.id,
      ],
    }),
  ],
)

/**
 * An upload in pieces (plan 04 M3, ADR 021), of one person: what was declared, the pieces
 * received with their sha256, and the media it became once complete.
 */
export const uploadSessions = pgTable(
  'upload_sessions',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    folderId: uuid('folder_id'),
    originalName: text('original_name').notNull(),
    // as declared: the type is read again from the bytes at completion
    mime: text('mime').notNull(),
    sizeBytes: bytes('size_bytes').notNull(),
    // piece number → hex sha256 of the piece received
    parts: jsonb('parts')
      .notNull()
      .default(sql`'{}'::jsonb`),
    expiresAt: tz('expires_at').notNull(),
    completedAt: tz('completed_at'),
    mediaId: uuid('media_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('upload_sessions_user_idx').on(t.organizationId, t.workspaceId, t.userId),
    foreignKey({
      name: 'upload_sessions_workspace_fk',
      columns: [t.organizationId, t.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }),
    foreignKey({
      name: 'upload_sessions_member_fk',
      columns: [t.organizationId, t.userId],
      foreignColumns: [organizationMembers.organizationId, organizationMembers.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'upload_sessions_folder_fk',
      columns: [t.organizationId, t.workspaceId, t.folderId],
      foreignColumns: [
        libraryFolders.organizationId,
        libraryFolders.workspaceId,
        libraryFolders.id,
      ],
    }),
    foreignKey({
      name: 'upload_sessions_media_fk',
      columns: [t.organizationId, t.workspaceId, t.mediaId],
      foreignColumns: [media.organizationId, media.workspaceId, media.id],
    }),
    check('upload_sessions_size', sql`${t.sizeBytes} > 0`),
    check('upload_sessions_original_name', sql`char_length(${t.originalName}) between 1 and 255`),
    check('upload_sessions_completed', sql`(${t.completedAt} is null) = (${t.mediaId} is null)`),
  ],
)

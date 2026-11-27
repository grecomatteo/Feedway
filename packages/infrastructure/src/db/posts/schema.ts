import {
  CAPTION_TEMPLATE_KINDS,
  LABEL_COLORS,
  POST_TYPES,
  PUBLISHING_POST_STATUSES,
  TARGET_STATUSES,
  TARGET_STEPS,
  ATTEMPT_OUTCOMES,
  BULK_SOURCES,
  BULK_STATUSES,
} from '@app/domain'
import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { socialAccounts } from '../accounts/schema.js'
import { createdAt, inList, tz, updatedAt } from '../columns.js'
import { media } from '../media/schema.js'
import { organizations } from '../organizations/schema.js'
import { workspaces } from '../workspaces/schema.js'

// The posts module (spec §13, plan 06 Task 3): every table carries the agency, and the composite
// keys keep a post, its files, its labels and its notes inside one workspace. The people
// (`created_by`, `author_id`…) have no foreign key, as `media.uploaded_by`: what they wrote
// stays when they leave the agency.

/** A post of a workspace; its state derives from its destinations (§9.3). */
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    workspaceId: uuid('workspace_id').notNull(),
    type: text('type').notNull(),
    caption: text('caption').notNull().default(''),
    // the text of a platform that has its own; missing = the common text (D-53)
    captionByPlatform: jsonb('caption_by_platform').notNull().default({}),
    scheduledAt: tz('scheduled_at'),
    // copied from the agency's settings when the post is created (D-58)
    timezone: text('timezone').notNull().default('Europe/Rome'),
    status: text('status').notNull().default('draft'),
    // { shareToFeed, choices } (P5)
    options: jsonb('options').notNull(),
    createdBy: uuid('created_by').notNull(),
    scheduledBy: uuid('scheduled_by'),
    updatedBy: uuid('updated_by').notNull(),
    version: integer('version').notNull().default(1),
    // in «Eliminati» since (plan 09 Scelta 12): the status stays, so «Ripristina» gives it back
    trashedAt: tz('trashed_at'),
    // null: the night's clean-up (no foreign key, as the audit's actor: the id stays)
    trashedBy: uuid('trashed_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // target of the composite foreign keys
    unique('posts_workspace_id').on(t.organizationId, t.workspaceId, t.id),
    // the night's clean-up and the «Eliminati» of a client
    index('posts_trashed_idx')
      .on(t.organizationId, t.trashedAt)
      .where(sql`${t.trashedAt} is not null`),
    index('posts_workspace_status_idx').on(
      t.organizationId,
      t.workspaceId,
      t.status,
      t.scheduledAt,
    ),
    foreignKey({
      name: 'posts_workspace_fk',
      columns: [t.organizationId, t.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }),
    check('posts_type', inList('type', POST_TYPES)),
    // derived from the destinations at every move (§9.3, plan 07 Scelta 3)
    check('posts_status', inList('status', PUBLISHING_POST_STATUSES)),
    check(
      'posts_scheduled_has_date',
      sql`${t.status} <> 'scheduled' or ${t.scheduledAt} is not null`,
    ),
    check('posts_version', sql`${t.version} >= 1`),
    // only a draft or a cancelled post goes to «Eliminati»
    check(
      'posts_trashed_status',
      sql`${t.trashedAt} is null or ${t.status} in ('draft', 'cancelled')`,
    ),
  ],
)

/** The files of a post, in its order; a reel's cover sits on its video (position 0). */
export const postMedia = pgTable(
  'post_media',
  {
    organizationId: uuid('organization_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    postId: uuid('post_id').notNull(),
    position: integer('position').notNull(),
    mediaId: uuid('media_id').notNull(),
    // a reel's cover: a photo of the workspace, or a frame of the video
    coverMediaId: uuid('cover_media_id'),
    coverOffsetMs: integer('cover_offset_ms'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.postId, t.position] }),
    // which posts use a file (the library's «Nel post del …», a delete refused)
    index('post_media_media_idx').on(t.organizationId, t.mediaId),
    foreignKey({
      name: 'post_media_post_fk',
      columns: [t.organizationId, t.workspaceId, t.postId],
      foreignColumns: [posts.organizationId, posts.workspaceId, posts.id],
    }).onDelete('cascade'),
    // files are never deleted for real (`status = 'deleted'`): the use case refuses a file of a
    // scheduled post, the key only keeps it in the workspace
    foreignKey({
      name: 'post_media_media_fk',
      columns: [t.organizationId, t.workspaceId, t.mediaId],
      foreignColumns: [media.organizationId, media.workspaceId, media.id],
    }),
    foreignKey({
      name: 'post_media_cover_fk',
      columns: [t.organizationId, t.workspaceId, t.coverMediaId],
      foreignColumns: [media.organizationId, media.workspaceId, media.id],
    }),
    check('post_media_position', sql`${t.position} >= 0`),
    check('post_media_one_cover', sql`${t.coverMediaId} is null or ${t.coverOffsetMs} is null`),
    check('post_media_cover_offset', sql`${t.coverOffsetMs} is null or ${t.coverOffsetMs} >= 0`),
  ],
)

/**
 * A destination of a post: one account. The account's key is the agency's, not the workspace's:
 * an account taken off the workspace keeps the drafts, and the checks call it unavailable.
 * The columns after `fingerprint` are stage 7's (§13), null until then.
 */
export const postTargets = pgTable(
  'post_targets',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    postId: uuid('post_id').notNull(),
    accountId: uuid('account_id').notNull(),
    status: text('status').notNull().default('draft'),
    // hex sha256 of `postFingerprint` after the choices, written when scheduled (P3)
    fingerprint: text('fingerprint'),
    variant: text('variant'),
    step: text('step'),
    metaIds: jsonb('meta_ids'),
    externalPostId: text('external_post_id'),
    permalink: text('permalink'),
    attempts: integer('attempts').notNull().default(0),
    // grows at every move and every new look at a container: the jobs' keys (plan 07 P3)
    generation: integer('generation').notNull().default(0),
    nextAttemptAt: tz('next_attempt_at'),
    // the preparation running on Meta now, until then: at most 3 per agency and 1 per account
    // (plan 07 «Lavori pesanti»); a worker gone leaves it to expire
    claimedUntil: tz('claimed_until'),
    // when the scheduled post is checked again, 3 hours before (Scelta 4); null: done
    recheckAt: tz('recheck_at'),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    publishedAt: tz('published_at'),
    verifiedAt: tz('verified_at'),
    verification: jsonb('verification'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('post_targets_post_account').on(t.organizationId, t.postId, t.accountId),
    // target of the composite foreign key from target_attempts
    unique('post_targets_workspace_id').on(t.organizationId, t.workspaceId, t.id),
    // the reconciler's read across the agencies (`dueTargets`, plan 07 Task 3)
    index('post_targets_due_idx').on(t.status, t.nextAttemptAt),
    // the search after an uncertain call and the reels of the last 24 hours
    index('post_targets_account_published_idx').on(t.organizationId, t.accountId, t.publishedAt),
    // the preparations running in an agency (`claimPrepare`)
    index('post_targets_claimed_idx')
      .on(t.organizationId, t.accountId)
      .where(sql`${t.claimedUntil} is not null`),
    // the checks 3 hours before, read by the reconciler across the agencies (`dueRechecks`)
    index('post_targets_recheck_idx')
      .on(t.recheckAt)
      .where(sql`${t.recheckAt} is not null`),
    index('post_targets_account_status_idx').on(t.organizationId, t.accountId, t.status),
    index('post_targets_account_fingerprint_idx').on(t.organizationId, t.accountId, t.fingerprint),
    foreignKey({
      name: 'post_targets_post_fk',
      columns: [t.organizationId, t.workspaceId, t.postId],
      foreignColumns: [posts.organizationId, posts.workspaceId, posts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'post_targets_account_fk',
      columns: [t.organizationId, t.accountId],
      foreignColumns: [socialAccounts.organizationId, socialAccounts.id],
    }),
    check('post_targets_status', inList('status', TARGET_STATUSES)),
    check('post_targets_step', sql`${t.step} is null or ${inList('step', TARGET_STEPS)}`),
    check('post_targets_generation', sql`${t.generation} >= 0`),
    check(
      'post_targets_fingerprint',
      sql`${t.fingerprint} is null or ${t.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check('post_targets_attempts', sql`${t.attempts} >= 0`),
  ],
)

/**
 * One call of a step to the platform (§9.5, §13): what was tried, how it ended, how long it took.
 * No text, token or answer of the platform: only the codes.
 */
export const targetAttempts = pgTable(
  'target_attempts',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    targetId: uuid('target_id').notNull(),
    step: text('step').notNull(),
    outcome: text('outcome').notNull(),
    // Feedway's code (`PUBLISH_ERROR_CODES`) and Meta's `code/subcode`, never Meta's message
    errorCode: text('error_code'),
    metaErrorCode: text('meta_error_code'),
    durationMs: integer('duration_ms').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('target_attempts_target_idx').on(t.organizationId, t.targetId, t.createdAt),
    foreignKey({
      name: 'target_attempts_target_fk',
      columns: [t.organizationId, t.workspaceId, t.targetId],
      foreignColumns: [postTargets.organizationId, postTargets.workspaceId, postTargets.id],
    }).onDelete('cascade'),
    check('target_attempts_step', inList('step', TARGET_STEPS)),
    check('target_attempts_outcome', inList('outcome', ATTEMPT_OUTCOMES)),
    check('target_attempts_duration', sql`${t.durationMs} >= 0`),
    check(
      'target_attempts_error_code',
      sql`${t.errorCode} is null or ${t.errorCode} ~ '^[a-z_]{1,40}$'`,
    ),
    check(
      'target_attempts_meta_error_code',
      sql`${t.metaErrorCode} is null or ${t.metaErrorCode} ~ '^[0-9]{1,10}(/[0-9]{1,10})?$'`,
    ),
  ],
)

/** A coloured label of a workspace (§11.7). */
export const labels = pgTable(
  'labels',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    workspaceId: uuid('workspace_id').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('labels_workspace_id').on(t.organizationId, t.workspaceId, t.id),
    // «Promo» and «promo» are one label
    uniqueIndex('labels_workspace_name').on(t.organizationId, t.workspaceId, sql`lower(${t.name})`),
    foreignKey({
      name: 'labels_workspace_fk',
      columns: [t.organizationId, t.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }),
    check('labels_name', sql`char_length(${t.name}) between 1 and 40`),
    check('labels_color', inList('color', LABEL_COLORS)),
  ],
)

export const postLabels = pgTable(
  'post_labels',
  {
    organizationId: uuid('organization_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    postId: uuid('post_id').notNull(),
    labelId: uuid('label_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.postId, t.labelId] }),
    index('post_labels_label_idx').on(t.organizationId, t.labelId),
    foreignKey({
      name: 'post_labels_post_fk',
      columns: [t.organizationId, t.workspaceId, t.postId],
      foreignColumns: [posts.organizationId, posts.workspaceId, posts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'post_labels_label_fk',
      columns: [t.organizationId, t.workspaceId, t.labelId],
      foreignColumns: [labels.organizationId, labels.workspaceId, labels.id],
    }).onDelete('cascade'),
  ],
)

/** An internal note on a post, never shown to clients (§11.7). */
export const postNotes = pgTable(
  'post_notes',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    postId: uuid('post_id').notNull(),
    authorId: uuid('author_id').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('post_notes_post_idx').on(t.organizationId, t.postId, t.createdAt),
    foreignKey({
      name: 'post_notes_post_fk',
      columns: [t.organizationId, t.workspaceId, t.postId],
      foreignColumns: [posts.organizationId, posts.workspaceId, posts.id],
    }).onDelete('cascade'),
    check('post_notes_body', sql`char_length(${t.body}) between 1 and 2000`),
  ],
)

/** A text, signature or set of hashtags of a workspace, inserted with a tap (§11.7). */
export const captionTemplates = pgTable(
  'caption_templates',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    workspaceId: uuid('workspace_id').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('caption_templates_workspace_idx').on(t.organizationId, t.workspaceId, t.kind),
    foreignKey({
      name: 'caption_templates_workspace_fk',
      columns: [t.organizationId, t.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }),
    check('caption_templates_kind', inList('kind', CAPTION_TEMPLATE_KINDS)),
    check('caption_templates_name', sql`char_length(${t.name}) between 1 and 80`),
    check('caption_templates_body', sql`char_length(${t.body}) between 1 and 70000`),
  ],
)

/**
 * Saved accounts of a workspace (§11.7). `account_ids` has no foreign key: the use case takes
 * only accounts of the workspace, and the editor skips one taken off it since.
 */
export const accountGroups = pgTable(
  'account_groups',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    workspaceId: uuid('workspace_id').notNull(),
    name: text('name').notNull(),
    accountIds: uuid('account_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('account_groups_workspace_idx').on(t.organizationId, t.workspaceId),
    foreignKey({
      name: 'account_groups_workspace_fk',
      columns: [t.organizationId, t.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }),
    check('account_groups_name', sql`char_length(${t.name}) between 1 and 80`),
  ],
)

/**
 * The usual times of a workspace (spec §11.6, plan 09 Task 9): a weekday (ISO, 1 Monday) and a
 * local time of the agency's zone. The editor's «Prossima fascia libera» and the bulk schedule
 * read them; they are replaced as a whole.
 */
export const timeSlots = pgTable(
  'time_slots',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    workspaceId: uuid('workspace_id').notNull(),
    weekday: smallint('weekday').notNull(),
    localTime: time('local_time').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('time_slots_workspace_slot_idx').on(
      t.organizationId,
      t.workspaceId,
      t.weekday,
      t.localTime,
    ),
    foreignKey({
      name: 'time_slots_workspace_fk',
      columns: [t.organizationId, t.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }),
    check('time_slots_weekday', sql`${t.weekday} between 1 and 7`),
    // hours and minutes only, as `plan_items.local_time`
    check(
      'time_slots_local_time',
      sql`${t.localTime} < '24:00' and date_trunc('minute', ${t.localTime}) = ${t.localTime}`,
    ),
  ],
)

/**
 * One import in bulk (spec §11.6, plan 09 Task 10, P5): the rows the panel sent, each with the
 * outcome written in the transaction that created its post, so a run restarted goes on from the
 * first row without one. `created_by` has no foreign key, as `posts.created_by`.
 */
export const bulkImports = pgTable(
  'bulk_imports',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    workspaceId: uuid('workspace_id').notNull(),
    createdBy: uuid('created_by').notNull(),
    source: text('source').notNull(),
    // [{ input, outcome }]: what the row asked for and what it became (null: still to do)
    rows: jsonb('rows').notNull(),
    status: text('status').notNull().default('pending'),
    // the counts of the outcomes (`bulkSummary`), written with each row
    summary: jsonb('summary').notNull().default({}),
    createdAt: createdAt(),
    finishedAt: tz('finished_at'),
  },
  (t) => [
    index('bulk_imports_workspace_idx').on(t.organizationId, t.workspaceId, t.createdAt),
    foreignKey({
      name: 'bulk_imports_workspace_fk',
      columns: [t.organizationId, t.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }),
    check('bulk_imports_source', inList('source', BULK_SOURCES)),
    check('bulk_imports_status', inList('status', BULK_STATUSES)),
    check('bulk_imports_rows', sql`jsonb_typeof(${t.rows}) = 'array'`),
    check(
      'bulk_imports_finished',
      sql`(${t.status} in ('done', 'undone')) = (${t.finishedAt} is not null)`,
    ),
  ],
)

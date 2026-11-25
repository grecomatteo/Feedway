import { z } from 'zod'
import { Id, OrgSlug, Timestamp } from './common.js'
import { defineContract } from './define.js'
import {
  LocalDate,
  LocalTime,
  POST_CHECK_LIMITS,
  POST_CHECK_TYPES,
  PostCaptionBody,
  PostCoverBody,
  RuleChoiceBody,
} from './rules.js'

// Programming in bulk and «Duplica» (spec §11.6, plan 09 Task 10, P5). The table lives in the
// panel; «Programma» sends its rows, already checked by this schema, and the worker creates the
// posts one row per transaction. Starting an import takes `post.publish` (§10.2, from Publisher);
// an import is read and undone only by who started it, anyone else's is 404 as another
// client's. «Duplica» copies a post of the same client on up to 31 dates (Scelta 9).

/** As `BULK_MAX_ROWS` and `DUPLICATE_MAX_DATES` of @app/domain (contracts depend on zod only). */
export const BULK_LIMITS = { rows: 50, duplicateDates: 31 } as const

const When = z.strictObject({ localDate: LocalDate, localTime: LocalTime })

/** One row of the table: a post's content, its day and time in the agency's time zone. */
export const BulkRowBody = z.strictObject({
  type: z.enum(POST_CHECK_TYPES),
  mediaIds: z.array(Id).max(POST_CHECK_LIMITS.media),
  cover: PostCoverBody.nullable().optional(),
  caption: PostCaptionBody,
  /** one account or the accounts of a saved group, already expanded by the panel */
  destinations: z.array(z.strictObject({ accountId: Id })).max(POST_CHECK_LIMITS.destinations),
  /** null: the row stays a draft («no_date») */
  when: When.nullable(),
  shareToFeed: z.boolean().optional(),
  choices: z.array(RuleChoiceBody).max(POST_CHECK_LIMITS.choices).optional(),
  labelIds: z.array(Id).max(100).optional(),
})
export type BulkRowBody = z.infer<typeof BulkRowBody>

export const StartBulkImportRequest = z.strictObject({
  source: z.enum(['files', 'csv']),
  rows: z.array(BulkRowBody).min(1).max(BULK_LIMITS.rows),
})

const Undo = z.enum(['removed', 'kept'])

/** The outcome of one row; null while it is still to do. */
export const BulkRowOutcomeDto = z
  .discriminatedUnion('status', [
    z.object({
      status: z.literal('scheduled'),
      postId: Id,
      version: z.number().int(),
      undo: Undo.optional(),
    }),
    z.object({
      status: z.literal('draft'),
      postId: Id,
      version: z.number().int(),
      /** asked, blocked, no_date, limit_reached, not_allowed */
      reason: z.enum(['asked', 'blocked', 'no_date', 'limit_reached', 'not_allowed']),
      /** the codes of the blocks and of the warnings without a choice (`rules.<code>`) */
      codes: z.array(z.string()),
      undo: Undo.optional(),
    }),
    /** the row created nothing: `not_found` (a file, an account, a label of another client)… */
    z.object({ status: z.literal('failed'), code: z.string() }),
  ])
  .nullable()

export const BulkImportResponse = z.object({
  id: Id,
  workspaceId: Id,
  source: z.enum(['files', 'csv', 'duplicate']),
  status: z.enum(['pending', 'running', 'done', 'undone']),
  total: z.number().int(),
  done: z.number().int(),
  summary: z.object({
    scheduled: z.number().int(),
    drafts: z.number().int(),
    failed: z.number().int(),
    removed: z.number().int(),
    kept: z.number().int(),
  }),
  /** in the order sent */
  rows: z.array(BulkRowOutcomeDto),
  /** until when «Annulla» is offered; null: it is not */
  undoUntil: Timestamp.nullable(),
  createdAt: Timestamp,
  finishedAt: Timestamp.nullable(),
})
export type BulkImportResponse = z.infer<typeof BulkImportResponse>

export const DuplicatePostRequest = z.strictObject({
  dates: z
    .array(When)
    .min(1)
    .max(BULK_LIMITS.duplicateDates)
    .refine(
      (dates) => new Set(dates.map((d) => `${d.localDate} ${d.localTime}`)).size === dates.length,
      {
        message: 'each date once',
      },
    ),
  /** «Duplica e programma»: the copies whose checks pass are scheduled */
  schedule: z.boolean(),
})

const WorkspaceParams = z.strictObject({ org: OrgSlug, id: Id })
const ImportParams = z.strictObject({ org: OrgSlug, id: Id, importId: Id })
const PostParams = z.strictObject({ org: OrgSlug, id: Id, postId: Id })

// 50 rows of up to three texts: realistic captions stay far below; a larger body is a 413
const BULK_BODY_BYTES = 4 * 1024 * 1024

export const startBulkImportRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/bulk-imports',
  summary:
    'Programma in blocco le righe della tabella: il worker crea un post per riga, programmato se i controlli passano',
  request: { params: WorkspaceParams, body: StartBulkImportRequest },
  response: BulkImportResponse,
  auth: 'session',
  scope: 'organization',
  maxBodyBytes: BULK_BODY_BYTES,
})

export const getBulkImportRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/bulk-imports/{importId}',
  summary: 'Una programmazione in blocco di chi la legge, con l’esito di ogni riga',
  request: { params: ImportParams },
  response: BulkImportResponse,
  auth: 'session',
  scope: 'organization',
})

export const undoBulkImportRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/bulk-imports/{importId}/undo',
  summary:
    'Annulla una programmazione in blocco entro 10 secondi: toglie i post che nessuno ha toccato',
  request: { params: ImportParams },
  response: BulkImportResponse,
  auth: 'session',
  scope: 'organization',
})

export const duplicatePostRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/duplicate',
  summary:
    'Duplica un post dello stesso cliente su altre date: bozze, o programmati se i controlli passano',
  request: { params: PostParams, body: DuplicatePostRequest },
  response: BulkImportResponse,
  auth: 'session',
  scope: 'organization',
})

export const bulkRoutes = [
  startBulkImportRoute,
  getBulkImportRoute,
  undoBulkImportRoute,
  duplicatePostRoute,
] as const

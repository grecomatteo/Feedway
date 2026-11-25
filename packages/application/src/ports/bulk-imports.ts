import type {
  BulkRowOutcome,
  BulkSource,
  BulkStatus,
  BulkSummary,
  PostCaption,
  PostCover,
  PostType,
  RuleChoice,
} from '@app/domain'
import type { PostScope } from './posts.js'

// The imports in bulk (spec §11.6, plan 09 Task 10, P5). Every method takes the agency and
// filters by it in SQL as well: row level security is the second barrier.

/** One row as the panel sent it: a post's content, in the agency's time zone. */
export interface BulkRowInput {
  type: PostType
  mediaIds: readonly string[]
  cover: PostCover | null
  caption: PostCaption
  destinations: readonly { accountId: string }[]
  when: { localDate: string; localTime: string } | null
  shareToFeed: boolean
  choices: readonly RuleChoice[]
  labelIds: readonly string[]
}

export interface BulkRow {
  input: BulkRowInput
  /** null: still to do */
  outcome: BulkRowOutcome | null
}

export interface BulkImportRecord {
  id: string
  organizationId: string
  workspaceId: string
  createdBy: string
  source: BulkSource
  rows: BulkRow[]
  status: BulkStatus
  summary: BulkSummary
  createdAt: Date
  finishedAt: Date | null
}

export interface BulkImportChange {
  status: BulkStatus
  rows: readonly BulkRow[]
  summary: BulkSummary
  finishedAt: Date | null
}

export interface BulkImportsRepository {
  insert(record: Omit<BulkImportRecord, 'createdAt'>): Promise<void>
  /** In the workspace; null: not there (another workspace or agency is «not found»). */
  find(scope: PostScope, id: string): Promise<BulkImportRecord | null>
  /**
   * The import, locked until the transaction ends: its rows are written one at a time, also by
   * two workers that took the same job.
   */
  findForUpdate(organizationId: string, id: string): Promise<BulkImportRecord | null>
  update(organizationId: string, id: string, change: BulkImportChange): Promise<void>
  /** An import whose job could not be sent: only while it is still `pending`. */
  /** Removes an import still `pending`; false when a job already took it. */
  deletePending(organizationId: string, id: string): Promise<boolean>
}

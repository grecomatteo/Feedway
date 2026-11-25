import {
  BULK_MAX_ROWS,
  DUPLICATE_MAX_DATES,
  DomainError,
  bulkSummary,
  bulkUndoUntil,
  can,
  canUndoBulk,
  type BulkRowOutcome,
  type BulkSource,
  type BulkStatus,
  type BulkSummary,
  type OrgActor,
} from '@app/domain'
import { getAccountsForRules } from '../accounts/index.js'
import { isUuid } from '../identity/index.js'
import type { BulkImportRecord, BulkRow, BulkRowInput } from '../ports/bulk-imports.js'
import type { Tx } from '../ports/tx.js'
import {
  assertReferences,
  mayEditContent,
  mayPublish,
  openPosts,
  postNotFound,
  recordPost,
  type PostsDeps,
} from './common.js'
import { createScheduled, mayImportInBulk, type CreatedPost } from './create-scheduled.js'
import { NOTHING_AFTER, sendAfterSchedule, type AfterSchedule } from './schedule.js'

// Programming in bulk and «Duplica» (spec §11.6, plan 09 Task 10, P5). The table lives in the
// panel until «Programma»: then the rows are kept in `bulk_imports` and `bulk.import` creates the
// posts one row per transaction, the outcome of each written in the transaction of its post, so a
// run restarted goes on from the first row without one and never makes a post twice. «Duplica» is
// synchronous, in one transaction, and kept as an import of its own, so «Annulla» is the same.

export const bulkImportNotFound = () =>
  new DomainError('NOT_FOUND', 'Programmazione in blocco non trovata')

export const cannotImportInBulk = () =>
  new DomainError(
    'FORBIDDEN',
    'Non puoi programmare post in questo cliente: la programmazione in blocco è da Publisher',
  )

/** What the panel reads of an import: the outcome of each row, never its texts again. */
export interface BulkImportDto {
  id: string
  workspaceId: string
  source: BulkSource
  status: BulkStatus
  total: number
  /** the rows with their outcome */
  done: number
  summary: BulkSummary
  /** in the order sent; null: still to do */
  rows: (BulkRowOutcome | null)[]
  /** ISO 8601 until «Annulla» is offered; null: it is not */
  undoUntil: string | null
  createdAt: string
  finishedAt: string | null
}

export function toBulkImportDto(record: BulkImportRecord): BulkImportDto {
  const outcomes = record.rows.map((r) => r.outcome)
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    source: record.source,
    status: record.status,
    total: record.rows.length,
    done: outcomes.filter((o) => o !== null).length,
    summary: bulkSummary(outcomes),
    rows: outcomes,
    undoUntil: bulkUndoUntil(record.status, record.finishedAt)?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    finishedAt: record.finishedAt?.toISOString() ?? null,
  }
}

/** Every label given is of the workspace: one of another client or agency is «not found». */
async function assertLabels(
  tx: Tx,
  scope: { organizationId: string; workspaceId: string },
  labelIds: readonly string[],
) {
  const wanted = [...new Set(labelIds)]
  if (wanted.length === 0) return
  const found = await tx.contentSettings.existingLabels(scope, wanted.filter(isUuid))
  if (wanted.some((id) => !found.has(id)))
    throw new DomainError('NOT_FOUND', 'Etichetta non trovata')
}

/** The person as an actor of the agency: `openPosts` reads the role and the clients again. */
const actorOf = (organizationId: string, userId: string): OrgActor => ({
  userId,
  platformRole: null,
  organizationId,
  orgRole: 'member',
  memberships: new Map(),
})

const bulkUndoClosed = () =>
  new DomainError('CONFLICT', 'Non si può più annullare: sono passati più di 10 secondi', {
    reason: 'bulk_undo_closed',
  })

/** The import of the person who started it: anyone else's, as another client's, is «not found». */
async function ownImport(tx: Tx, actor: OrgActor, workspaceId: string, importId: string) {
  if (!isUuid(importId)) throw bulkImportNotFound()
  const record = await tx.bulkImports.findForUpdate(actor.organizationId, importId)
  if (record?.workspaceId !== workspaceId || record.createdBy !== actor.userId)
    throw bulkImportNotFound()
  return record
}

/**
 * «Programma» of the table (Scelta 7): the rows are kept and the worker creates the posts. The
 * job is sent after the commit, so it always finds the rows; if it cannot be sent, the import is
 * taken back and the request fails, with the table still in the panel (nothing was created yet).
 */
export async function startBulkImport(
  deps: Pick<PostsDeps, 'uow' | 'queue' | 'ids' | 'logger'>,
  actor: OrgActor,
  input: { workspaceId: string; source: Exclude<BulkSource, 'duplicate'>; rows: BulkRowInput[] },
): Promise<BulkImportDto> {
  if (input.rows.length === 0 || input.rows.length > BULK_MAX_ROWS)
    throw new DomainError('VALIDATION', `Da 1 a ${String(BULK_MAX_ROWS)} post per volta`, {
      field: 'rows',
    })
  const own = { organizationId: actor.organizationId, userId: actor.userId }
  const dto = await deps.uow.run(own, async (tx) => {
    const { current, scope } = await openPosts(tx, actor, input.workspaceId, { write: true })
    if (!mayImportInBulk(current, scope)) throw cannotImportInBulk()
    // a file, an account or a label of another client is «not found» now, not a row failed later
    for (const row of input.rows) {
      await assertReferences(tx, scope, { ...row }, null)
      await assertLabels(tx, scope, row.labelIds)
    }
    const id = deps.ids.newId()
    await tx.bulkImports.insert({
      id,
      ...scope,
      createdBy: current.userId,
      source: input.source,
      rows: input.rows.map((row) => ({ input: row, outcome: null })),
      status: 'pending',
      summary: bulkSummary([]),
      finishedAt: null,
    })
    const created = await tx.bulkImports.find(scope, id)
    if (!created) throw new Error('bulk import not found after insert')
    return toBulkImportDto(created)
  })
  try {
    await deps.queue.send(
      'bulk.import',
      { organizationId: actor.organizationId, bulkImportId: dto.id, userId: actor.userId },
      { singletonKey: dto.id },
    )
  } catch (error) {
    deps.logger.error({ err: error, bulkImportId: dto.id }, 'bulk import not queued')
    // nothing was created yet: the panel keeps its table and «Programma» can be pressed again.
    // Not pending any more means the job was stored after all and runs: a second «Programma»
    // would make every post twice, so the import is answered as started.
    const removed = await deps.uow.run(own, (tx) =>
      tx.bulkImports.deletePending(actor.organizationId, dto.id),
    )
    if (removed) throw error
  }
  return dto
}

/** The import, for the person who started it: the panel follows it until it is done. */
export async function getBulkImport(
  deps: Pick<PostsDeps, 'uow'>,
  actor: OrgActor,
  input: { workspaceId: string; importId: string },
): Promise<BulkImportDto> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope } = await openPosts(tx, actor, input.workspaceId, { write: false })
      if (!isUuid(input.importId)) throw bulkImportNotFound()
      const record = await tx.bulkImports.find(scope, input.importId)
      if (!record || record.createdBy !== current.userId) throw bulkImportNotFound()
      return toBulkImportDto(record)
    },
  )
}

/** The code of a row that created nothing: the reason of the error, or its code. */
function failureCode(error: DomainError): string {
  const reason = error.details?.reason
  return typeof reason === 'string' ? reason : error.code.toLowerCase()
}

export interface BulkImportReport {
  /** the rows this run wrote, failed ones included */
  rows: number
  finished: boolean
}

/**
 * `bulk.import` (P5): the rows without an outcome, one per transaction, each with the import
 * locked, so two workers on the same job write each row once. A row whose post is refused
 * (a file of another client, the person out of the agency) is `failed` with its code, written in
 * a transaction of its own after the first is rolled back. The last row ends the import and
 * writes `bulk.completed` for whoever started it.
 */
export async function runBulkImport(
  deps: PostsDeps,
  data: { organizationId: string; bulkImportId: string; userId: string },
): Promise<BulkImportReport> {
  const { organizationId, bulkImportId, userId } = data
  const scope = { organizationId, userId }
  const actor = actorOf(organizationId, userId)
  const start = await deps.uow.run(scope, async (tx) => {
    const record = await tx.bulkImports.findForUpdate(organizationId, bulkImportId)
    // only the job «Programma» sent: an import of another agency, or of someone else, is missing
    if (record?.createdBy !== userId) return 'missing'
    if (record.status === 'done' || record.status === 'undone') return 'over'
    if (record.status === 'pending')
      await tx.bulkImports.update(organizationId, bulkImportId, {
        status: 'running',
        rows: record.rows,
        summary: record.summary,
        finishedAt: null,
      })
    return record.rows.length
  })
  // sent after the commit of «Programma»: an import not found is another agency's, or taken back
  if (start === 'missing' || start === 'over') return { rows: 0, finished: false }
  let rows = 0
  for (let index = 0; index < start; index += 1) {
    let written: { after: AfterSchedule } | null = null
    let refused: DomainError | null = null
    try {
      written = await deps.uow.run(scope, (tx) =>
        writeRow(tx, actor, bulkImportId, index, async (record, input) => {
          const { post, after: next } = await createScheduled(tx, deps, actor, {
            ...input,
            workspaceId: record.workspaceId,
            schedule: true,
          })
          return { outcome: post, after: next }
        }),
      )
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      refused = error
    }
    if (refused !== null) {
      const code = failureCode(refused)
      written = await deps.uow.run(scope, (tx) =>
        writeRow(tx, actor, bulkImportId, index, () =>
          Promise.resolve({ outcome: { status: 'failed', code }, after: NOTHING_AFTER }),
        ),
      )
    }
    if (written !== null) {
      rows += 1
      await sendAfterSchedule(deps, organizationId, written.after)
    }
  }
  const finished = await deps.uow.run(scope, (tx) =>
    finishImport(tx, deps, bulkImportId, organizationId),
  )
  return { rows, finished }
}

/**
 * One row in the transaction given: the import locked and read again, the row skipped when it
 * already has its outcome (written by another worker, or before a restart) or when the import
 * is no longer running. The outcome is written with the post.
 */
async function writeRow(
  tx: Tx,
  actor: OrgActor,
  bulkImportId: string,
  index: number,
  make: (
    record: BulkImportRecord,
    input: BulkRowInput,
  ) => Promise<{ outcome: BulkRowOutcome | CreatedPost; after: AfterSchedule }>,
): Promise<{ after: AfterSchedule } | null> {
  const record = await tx.bulkImports.findForUpdate(actor.organizationId, bulkImportId)
  const row = record?.rows.at(index)
  if (!record || record.status !== 'running' || !row || row.outcome !== null) return null
  const { outcome, after } = await make(record, row.input)
  const rows = record.rows.map((r, i) => (i === index ? { ...r, outcome } : r))
  await tx.bulkImports.update(actor.organizationId, bulkImportId, {
    status: 'running',
    rows,
    summary: bulkSummary(rows.map((r) => r.outcome)),
    finishedAt: null,
  })
  return { after }
}

/** The end of a run: every row has its outcome; `bulk.completed` once, for whoever started it. */
async function finishImport(
  tx: Tx,
  deps: Pick<PostsDeps, 'clock'>,
  bulkImportId: string,
  organizationId: string,
): Promise<boolean> {
  const record = await tx.bulkImports.findForUpdate(organizationId, bulkImportId)
  if (!record || record.status !== 'running') return false
  if (record.rows.some((r) => r.outcome === null)) return false
  const summary = bulkSummary(record.rows.map((r) => r.outcome))
  await tx.bulkImports.update(organizationId, bulkImportId, {
    status: 'done',
    rows: record.rows,
    summary,
    finishedAt: deps.clock.now(),
  })
  await tx.outbox.record({
    organizationId,
    type: 'bulk.completed',
    payload: {
      workspaceId: record.workspaceId,
      bulkImportId,
      scheduled: summary.scheduled,
      drafts: summary.drafts,
      failed: summary.failed,
    },
    dedupeKey: `bulk.completed:${bulkImportId}`,
  })
  return true
}

/** Whether the post is as the import left it: same version, still a draft or not yet prepared. */
async function untouched(
  tx: Tx,
  post: { organizationId: string; id: string; status: string; version: number },
  version: number,
) {
  if (post.version !== version) return false
  if (post.status === 'draft') return true
  if (post.status !== 'scheduled') return false
  // a destination already in preparation or beyond keeps the post (P5)
  const targets = await tx.publishing.targetsOfPost(post.organizationId, post.id)
  return targets.every((t) => t.status === 'scheduled' || t.status === 'cancelled')
}

/**
 * «Annulla» (P5), checked by the server: for 10 seconds after the end, the posts of the import
 * that nobody touched since are deleted, a scheduled one with its destinations; a post changed
 * since, or already in preparation, stays, and the summary says how many.
 */
export async function undoBulkImport(
  deps: Pick<PostsDeps, 'uow' | 'clock'>,
  actor: OrgActor,
  input: { workspaceId: string; importId: string },
  request: { ip: string | null },
): Promise<BulkImportDto> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      // an import still running is refused before any lock: its rows take the import and then
      // the client, the other way round from here
      if (isUuid(input.workspaceId) && isUuid(input.importId)) {
        const seen = await tx.bulkImports.find(
          { organizationId: actor.organizationId, workspaceId: input.workspaceId },
          input.importId,
        )
        if (seen?.createdBy === actor.userId && seen.status !== 'done') throw bulkUndoClosed()
      }
      const { current, scope } = await openPosts(tx, actor, input.workspaceId, { write: true })
      const record = await ownImport(tx, current, scope.workspaceId, input.importId)
      if (!canUndoBulk(record.status, record.finishedAt, deps.clock.now())) throw bulkUndoClosed()
      const rows: BulkRow[] = []
      for (const row of record.rows) {
        const outcome = row.outcome
        if (outcome === null || outcome.status === 'failed') {
          rows.push(row)
          continue
        }
        const post = await tx.posts.findForUpdate(scope, outcome.postId)
        let undo: 'removed' | 'kept' = 'removed'
        if (post) {
          // a scheduled post is taken back only by who may still publish it
          const allowed =
            mayEditContent(current, post) &&
            (outcome.status === 'draft' || mayPublish(current, post))
          if (allowed && (await untouched(tx, post, outcome.version))) {
            if (!(await tx.posts.delete(scope, post.id))) throw postNotFound()
            await recordPost(tx, current, 'post.deleted', post, request.ip)
          } else undo = 'kept'
        }
        rows.push({ ...row, outcome: { ...outcome, undo } })
      }
      await tx.bulkImports.update(scope.organizationId, record.id, {
        status: 'undone',
        rows,
        summary: bulkSummary(rows.map((r) => r.outcome)),
        finishedAt: record.finishedAt,
      })
      const updated = await tx.bulkImports.find(scope, record.id)
      if (!updated) throw bulkImportNotFound()
      return toBulkImportDto(updated)
    },
  )
}

/** One date of «Duplica»: the day and the time, in the agency's time zone. */
export interface DuplicateDate {
  localDate: string
  localTime: string
}

/**
 * «Duplica» (Scelta 9, decided by Matteo on 24/11): the post copied on up to 31 dates of the
 * same client, with its texts per platform, type, files, cover, labels, choices and the accounts
 * still assigned to the client. The copies are drafts; «Duplica e programma» schedules those
 * whose checks pass. One transaction; kept as an import of its own for «Annulla».
 */
export async function duplicatePost(
  deps: PostsDeps,
  actor: OrgActor,
  input: { workspaceId: string; postId: string; dates: DuplicateDate[]; schedule: boolean },
  request: { ip: string | null },
): Promise<BulkImportDto> {
  const keys = new Set(input.dates.map((d) => `${d.localDate} ${d.localTime}`))
  if (
    input.dates.length === 0 ||
    input.dates.length > DUPLICATE_MAX_DATES ||
    keys.size !== input.dates.length
  )
    throw new DomainError(
      'VALIDATION',
      `Da 1 a ${String(DUPLICATE_MAX_DATES)} date, ognuna una volta`,
      { field: 'dates' },
    )
  const { dto, afters } = await deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope } = await openPosts(tx, actor, input.workspaceId, { write: true })
      if (!isUuid(input.postId)) throw postNotFound()
      const source = await tx.posts.find(scope, input.postId)
      // who cannot write in the client does not learn the post is there (plan 09 Task 10)
      if (!source || !can(current, 'post.draft', scope)) throw postNotFound()
      if (input.schedule && !mayImportInBulk(current, scope)) throw cannotImportInBulk()
      // an account taken off the client since is not copied: the copy could not be saved with it
      const wanted = source.targets.filter((t) => !t.cancelledInPanel).map((t) => t.accountId)
      const assigned = await getAccountsForRules(tx, scope, wanted)
      const base: Omit<BulkRowInput, 'when'> = {
        type: source.type,
        mediaIds: source.mediaIds,
        cover: source.cover,
        caption: { common: source.caption, ...source.captionByPlatform },
        destinations: wanted.filter((id) => assigned.has(id)).map((accountId) => ({ accountId })),
        shareToFeed: source.options.shareToFeed,
        choices: source.options.choices,
        labelIds: source.labelIds,
      }
      const rows: BulkRow[] = []
      const afters: AfterSchedule[] = []
      for (const when of input.dates) {
        const row: BulkRowInput = { ...base, when }
        const { post, after } = await createScheduled(tx, deps, current, {
          ...row,
          workspaceId: scope.workspaceId,
          schedule: input.schedule,
          ip: request.ip,
        })
        rows.push({ input: row, outcome: post })
        afters.push(after)
      }
      const id = deps.ids.newId()
      await tx.bulkImports.insert({
        id,
        ...scope,
        createdBy: current.userId,
        source: 'duplicate',
        rows,
        status: 'done',
        summary: bulkSummary(rows.map((r) => r.outcome)),
        finishedAt: deps.clock.now(),
      })
      const created = await tx.bulkImports.find(scope, id)
      if (!created) throw new Error('duplicate not found after insert')
      return { dto: toBulkImportDto(created), afters }
    },
  )
  for (const after of afters) await sendAfterSchedule(deps, actor.organizationId, after)
  return dto
}

import { EMPTY_DRAFT_KEEP_MS, TRASH_KEEP_DAYS, autoTrashAt } from '@app/domain'
import type { Clock } from '../ports/clock.js'
import type { Logger } from '../ports/logger.js'
import type { ExclusiveLock } from '../ports/media-processing.js'
import type { PostRecord, PostScope } from '../ports/posts.js'
import type { WorkspaceRecord } from '../ports/repositories.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { isEmptyDraft } from './calendar.js'

// `posts.drafts_cleanup` (plan 09 Task 14, Scelta 12): every night, the posts in «Eliminati» for
// more than 30 days go for good, the empty drafts nobody touched for 24 hours too, and the drafts
// nobody touched for the days their client chose go to «Eliminati». An archived client and a
// suspended agency are left alone. The system scope only lists the agencies; each one is cleaned
// in its own scope, and every post is locked and read again before it goes, so a draft written
// meanwhile stays and, with two workers, each post goes once.

export interface DraftsCleanupDeps {
  uow: UnitOfWork
  clock: Clock
  logger: Logger
  /** The installation's lock (ADR 021): with more workers, one run at a time */
  lock: ExclusiveLock
}

export interface DraftsCleanupReport {
  /** false: another worker holds the run */
  ran: boolean
  organizations: number
  /** deleted for good: from «Eliminati», or empty */
  deleted: number
  /** sent to «Eliminati» */
  trashed: number
  /** agencies whose step failed: logged, and the job fails at the end to be retried */
  failed: number
}

export const DRAFTS_CLEANUP_LOCK = 'posts.drafts_cleanup'
/** Of each kind, per agency and night; what is left goes the next night. */
export const DRAFTS_CLEANUP_BATCH = 1000

const DAY_MS = 86_400_000

/** The log of the night: no person, the reason the retention. */
async function record(tx: Tx, action: 'post.trashed' | 'post.deleted', post: PostRecord) {
  await tx.audit.record({
    organizationId: post.organizationId,
    actorId: null,
    source: 'system',
    action,
    entity: 'post',
    entityId: post.id,
    workspaceId: post.workspaceId,
    ip: null,
    data: { reason: 'retention' },
  })
}

async function cleanAgency(tx: Tx, organizationId: string, now: Date) {
  const trashedBefore = new Date(now.getTime() - TRASH_KEEP_DAYS * DAY_MS)
  const emptyBefore = new Date(now.getTime() - EMPTY_DRAFT_KEEP_MS)
  const found = await tx.posts.cleanupCandidates(organizationId, {
    now,
    trashedBefore,
    emptyBefore,
    limit: DRAFTS_CLEANUP_BATCH,
  })
  const clients = new Map<string, WorkspaceRecord | null>()
  // read again under the client's share lock: an archiving under way is waited for
  const openClient = async (workspaceId: string) => {
    let workspace = clients.get(workspaceId)
    if (workspace === undefined) {
      const found = await tx.workspaces.findForShare(organizationId, workspaceId)
      workspace = found && found.archivedAt === null ? found : null
      clients.set(workspaceId, workspace)
    }
    return workspace
  }
  const lock = async (c: { id: string; workspaceId: string }) => {
    const workspace = await openClient(c.workspaceId)
    if (!workspace) return null
    const scope: PostScope = { organizationId, workspaceId: c.workspaceId }
    const post = await tx.posts.findForUpdate(scope, c.id)
    return post && { post, scope, workspace }
  }
  // in id order, as «Ripristina» and «Elimina per sempre» lock: the two never wait in a ring
  const byId = <T extends { id: string }>(list: readonly T[]) =>
    [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  let deleted = 0
  let trashed = 0
  for (const c of byId(found.expired)) {
    const locked = await lock(c)
    if (!locked?.post.trashedAt || locked.post.trashedAt >= trashedBefore) continue
    if (!(await tx.posts.delete(locked.scope, c.id))) continue
    await record(tx, 'post.deleted', locked.post)
    deleted++
  }
  for (const c of byId(found.empty)) {
    const locked = await lock(c)
    if (!locked) continue
    const { post } = locked
    if (post.trashedAt !== null || !isEmptyDraft(post) || post.updatedAt >= emptyBefore) continue
    // an internal note keeps it, as «Elimina le bozze vuote» does
    if ((await tx.posts.listNotes(locked.scope, post.id)).length > 0) continue
    if (!(await tx.posts.delete(locked.scope, c.id))) continue
    await record(tx, 'post.deleted', post)
    deleted++
  }
  for (const c of byId(found.stale)) {
    const locked = await lock(c)
    if (!locked) continue
    const { post, scope, workspace } = locked
    if (post.trashedAt !== null || post.status !== 'draft') continue
    const due = autoTrashAt(post.updatedAt, workspace.draftRetentionDays, post.scheduledAt)
    if (!due || due > now) continue
    if (!(await tx.posts.setTrashed(scope, post.id, { at: now, by: null }, null))) continue
    await record(tx, 'post.trashed', post)
    trashed++
  }
  return { deleted, trashed }
}

export async function cleanupDrafts(deps: DraftsCleanupDeps): Promise<DraftsCleanupReport> {
  const run = await deps.lock.tryRun(DRAFTS_CLEANUP_LOCK, async () => {
    const now = deps.clock.now()
    // a suspended agency is left alone: its people could not get a draft back before it goes
    const organizations = (
      await deps.uow.runAsSystem(
        'posts.drafts_cleanup: agencies',
        (tx) => tx.organizations.listAll(),
        { routine: true },
      )
    ).filter((o) => o.status === 'active')
    let deleted = 0
    let trashed = 0
    let failed = 0
    for (const organization of organizations) {
      try {
        const done = await deps.uow.run({ organizationId: organization.id, userId: null }, (tx) =>
          cleanAgency(tx, organization.id, now),
        )
        deleted += done.deleted
        trashed += done.trashed
      } catch (err) {
        failed += 1
        deps.logger.error({ organizationId: organization.id, err }, 'drafts clean-up step failed')
      }
    }
    return { organizations: organizations.length, deleted, trashed, failed }
  })
  if (!run.acquired) return { ran: false, organizations: 0, deleted: 0, trashed: 0, failed: 0 }
  if (run.value.failed > 0)
    throw new Error(`drafts clean-up failed for ${String(run.value.failed)} agencies`)
  return { ran: true, ...run.value }
}

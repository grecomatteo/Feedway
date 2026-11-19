import { can, type OrgActor } from '@app/domain'
import type { Tx } from '../ports/tx.js'

/** A file that the worker could not prepare, as «Da sistemare» of «Oggi» lists it (redesign R3). */
export interface FailedMediaView {
  id: string
  workspaceId: string
  originalName: string
  /** «Riprova» can prepare it again: the fault may be the machine's and the original is kept */
  retryable: boolean
  failedAt: Date
}

/** The failures that keep the original: the fault may be the machine's (D-39). */
const RETRYABLE: ReadonlySet<string> = new Set(['timeout', 'processing_failed'])
/** More than a person goes through in one sitting; D-43 clears them after a day anyway. */
const MAX_FAILED = 50

/**
 * The `failed` files of these workspaces, the latest 50 first, inside the caller's transaction.
 * Only the workspaces whose library the actor uses (`media.upload`): for a Viewer the files do
 * not exist (spec §10.2).
 */
export async function getFailedMedia(
  tx: Tx,
  actor: OrgActor,
  workspaceIds: readonly string[],
): Promise<FailedMediaView[]> {
  const { organizationId } = actor
  const library = workspaceIds.filter((workspaceId) =>
    can(actor, 'media.upload', { organizationId, workspaceId }),
  )
  const rows = await tx.media.listFailed(organizationId, library, MAX_FAILED)
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    originalName: r.originalName,
    retryable: r.hasOriginal && RETRYABLE.has(r.failure?.code ?? ''),
    failedAt: r.failedAt,
  }))
}

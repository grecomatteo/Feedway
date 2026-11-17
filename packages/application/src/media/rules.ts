import type { DraftMedia } from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { Tx } from '../ports/tx.js'

/**
 * The files of the workspace as the checks before scheduling read them (plan 05 R5), in one
 * query. A file of another workspace or agency, or an id that is not one, is left out: the
 * caller tells it apart from nothing else.
 */
export async function getMediaForRules(
  tx: Tx,
  scope: { organizationId: string; workspaceId: string },
  mediaIds: readonly string[],
): Promise<Map<string, DraftMedia>> {
  const ids = [...new Set(mediaIds.filter(isUuid))]
  if (ids.length === 0) return new Map()
  const found = await tx.media.forRules(scope.organizationId, scope.workspaceId, ids)
  return new Map(
    found.map((m) => [
      m.id,
      {
        mediaId: m.id,
        status: m.status,
        kind: m.kind,
        analysis: m.analysis,
        checks: m.checks,
        failure: m.failure,
        sha256: m.sha256,
      },
    ]),
  )
}

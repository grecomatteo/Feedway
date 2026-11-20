import { publishedFps, type MediaKind, type MediaStatus } from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { Tx } from '../ports/tx.js'

/** A file of a post as the editor shows it (plan 06 Task 4). */
export interface PostMediaView {
  id: string
  status: MediaStatus
  kind: MediaKind
  originalName: string
  /** of the original as uploaded: «Sostituisci» says it (D-98, B4) */
  sizeBytes: number
  width: number | null
  height: number | null
  durationMs: number | null
  /** of the copy that is published (D-60): the reel's cover is a frame of it */
  fps: number | null
  /** the copies the panel can ask for */
  variants: string[]
}

/**
 * The files of the workspace among these ids, deleted ones included, in two queries. An id of
 * another workspace or agency, or one that is not an id, is left out: for the posts module it
 * is a file not found.
 */
export async function getMediaForPosts(
  tx: Tx,
  scope: { organizationId: string; workspaceId: string },
  mediaIds: readonly string[],
): Promise<Map<string, PostMediaView>> {
  const ids = [...new Set(mediaIds.filter(isUuid))]
  if (ids.length === 0) return new Map()
  const found = await tx.media.findManyInWorkspace(scope.organizationId, scope.workspaceId, ids)
  const variants = await tx.media.variantsOf(
    scope.organizationId,
    found.filter((m) => m.status !== 'deleted').map((m) => m.id),
  )
  return new Map(
    found.map((m) => [
      m.id,
      {
        id: m.id,
        status: m.status,
        kind: m.kind,
        originalName: m.originalName,
        sizeBytes: m.sizeBytes,
        width: m.width,
        height: m.height,
        durationMs: m.durationMs,
        fps: publishedFps(m.fps, m.checks?.warnings ?? []),
        variants: variants.filter((v) => v.mediaId === m.id).map((v) => v.purpose),
      },
    ]),
  )
}

import { DomainError, distinctCopies, type CopyRequest, type OrgActor } from '@app/domain'
import { copyKey } from './publishing/copies-in-use.js'
import { publisherOf } from './publishing/context.js'
import type { PostRecord } from '../ports/posts.js'
import type { Tx } from '../ports/tx.js'
import { checkPostInTx, publishFilesOfPost, type CheckPostDeps } from '../rules/index.js'
import { toCheckInput } from './to-check-input.js'

// The post as each account received it, for the page of the outcome (plan 08 Task 10, D-120
// request 1): the text, the files in their order and the reel's cover of every destination, read
// as the worker reads them (`publishFilesOfPost`), so the panel shows what went out. The files are
// the copies that were published while they are kept (plan 07 Scelta 5), then the originals.

/** A file of a destination: the copy published, or the original once the copy is gone. */
export interface OutcomeFileDto {
  mediaId: string
  kind: 'image' | 'video'
  /** the copy that was published; null: gone (or never made), the original stands in */
  copyId: string | null
  width: number | null
  height: number | null
}

export interface OutcomeVersionDto {
  accountId: string
  platform: 'instagram' | 'facebook'
  /** what the post became on the account (§9.1), as the editor's preview takes it */
  format: string
  caption: string
  files: OutcomeFileDto[]
  /**
   * The reel's cover as the account shows it: the copy published, made of `mediaId` (the image
   * chosen, or the video at `offsetMs`). null: the platform's own (Facebook takes the first
   * frame, D-120.8).
   */
  cover: { mediaId: string; copyId: string | null; offsetMs: number | null } | null
}

export interface OutcomePreviewDto {
  /** true when some copy that went out is gone: the files shown are the originals */
  originals: boolean
  versions: OutcomeVersionDto[]
}

type PreviewDeps = Omit<CheckPostDeps, 'uow'>

/**
 * null when the post cannot be read as the worker would (no date, an archived client, the
 * files gone): the page falls back to the post's own files.
 */
export async function outcomePreview(
  tx: Tx,
  deps: PreviewDeps,
  actor: OrgActor,
  post: PostRecord,
  accountIds: readonly string[],
): Promise<OutcomePreviewDto | null> {
  const scope = { organizationId: post.organizationId, workspaceId: post.workspaceId }
  // the checks as the person who scheduled it: a Viewer reading the page could not run them
  const checker = (await publisherOf(tx, post)) ?? actor
  let report, files
  try {
    const input = toCheckInput(post, 'publish')
    report = await checkPostInTx(tx, deps, checker, input)
    files = await publishFilesOfPost(tx, deps, scope, input, report)
  } catch (error) {
    if (error instanceof DomainError) return null
    throw error
  }
  const wanted = distinctCopies(files)
  const mediaIds = [...new Set(wanted.map((c) => c.mediaId))]
  const copies = await tx.media.copiesOf(post.organizationId, mediaIds)
  const ready = new Map(
    copies.filter((c) => c.status === 'ready').map((c) => [copyKey(c), c] as const),
  )
  const originals = await tx.media.findManyInWorkspace(
    post.organizationId,
    post.workspaceId,
    mediaIds,
  )
  const byId = new Map(originals.map((m) => [m.id, m]))
  // every copy or none: a version made half of copies and half of originals would mislead
  const gone = wanted.some((c) => !ready.has(copyKey(c)))
  const fileOf = (c: CopyRequest): OutcomeFileDto => {
    const copy = gone ? undefined : ready.get(copyKey(c))
    const original = byId.get(c.mediaId)
    const kind = copy
      ? copy.mime === 'video/mp4'
        ? 'video'
        : 'image'
      : (original?.kind ?? 'image')
    return {
      mediaId: c.mediaId,
      kind: kind === 'video' ? 'video' : 'image',
      copyId: copy?.id ?? null,
      width: copy?.width ?? original?.width ?? null,
      height: copy?.height ?? original?.height ?? null,
    }
  }
  const out = new Set(accountIds)
  const versions = report.destinations.flatMap((d): OutcomeVersionDto[] => {
    const f = files.find((x) => x.accountId === d.accountId)
    if (!out.has(d.accountId) || !f || d.platform === null || d.format === null) return []
    const cover =
      // Facebook takes the first frame of a reel: the cover chosen goes only to Instagram
      f.cover === null || f.platform === 'facebook'
        ? null
        : {
            mediaId: f.cover.mediaId,
            copyId: gone ? null : (ready.get(copyKey(f.cover))?.id ?? null),
            offsetMs: post.cover?.source === 'frame' ? post.cover.offsetMs : null,
          }
    return [
      {
        accountId: d.accountId,
        platform: f.platform,
        format: d.format,
        caption: d.caption,
        files: f.media.map(fileOf),
        cover,
      },
    ]
  })
  return { originals: gone, versions }
}

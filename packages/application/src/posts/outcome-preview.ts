import {
  DomainError,
  distinctCopies,
  type CopyRequest,
  type DestinationFiles,
  type OrgActor,
  type RuleReport,
} from '@app/domain'
import { publishedFilesOf } from '../media/index.js'
import type { Logger } from '../ports/logger.js'
import type { PostRecord } from '../ports/posts.js'
import type { Tx } from '../ports/tx.js'
import { copyKey } from './publishing/copies-in-use.js'
import { publisherOf } from './publishing/context.js'
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
  /** true when some copy that went out is gone: the files shown are the originals, and the
   * page says so (never before the post went out, when the copies are still being made) */
  originals: boolean
  versions: OutcomeVersionDto[]
}

type PreviewDeps = Omit<CheckPostDeps, 'uow'> & { logger: Logger }

/**
 * null when the post cannot be read as the worker would (no date, an archived client, a file of
 * another client): the page falls back to the post's own files. The versions are computed now,
 * from the post, its accounts and the rules of today, as the worker would publish it now.
 */
export async function outcomePreview(
  tx: Tx,
  deps: PreviewDeps,
  input: {
    actor: OrgActor
    post: PostRecord
    targets: readonly { accountId: string; publishedAt: Date | null }[]
    /** the reader sees the files (`media.upload`): a Viewer gets no copy (D-72) */
    mayReadFiles: boolean
  },
): Promise<OutcomePreviewDto | null> {
  const { post } = input
  const scope = { organizationId: post.organizationId, workspaceId: post.workspaceId }
  let report: RuleReport
  let files: DestinationFiles[]
  try {
    // the checks as the person who scheduled it: a Viewer reading the page could not run them
    const checker = (await publisherOf(tx, post)) ?? input.actor
    const check = toCheckInput(post, 'publish')
    report = await checkPostInTx(tx, deps, checker, check)
    files = await publishFilesOfPost(tx, deps, scope, check, report)
  } catch (error) {
    // the page of the outcome stays readable: only this part of it is missing
    if (!(error instanceof DomainError))
      deps.logger.error({ err: error, postId: post.id }, 'outcome preview not computed')
    return null
  }
  const views = new Map(
    (await publishedFilesOf(tx, scope, distinctCopies(files))).map(
      (v) => [copyKey(v.request), v] as const,
    ),
  )
  const all = [...views.values()]
  // every copy or none: a version made half of copies and half of originals would mislead
  const copies = input.mayReadFiles && all.every((v) => v.copy !== null)
  const fileOf = (c: CopyRequest): OutcomeFileDto => {
    const v = views.get(copyKey(c))
    const copy = copies ? (v?.copy ?? null) : null
    const shown = copy ?? v?.original
    return {
      mediaId: c.mediaId,
      kind: shown?.kind ?? 'image',
      copyId: copy?.id ?? null,
      width: shown?.width ?? null,
      height: shown?.height ?? null,
    }
  }
  const out = new Map(input.targets.map((t) => [t.accountId, t] as const))
  const versions = report.destinations.flatMap((d): OutcomeVersionDto[] => {
    const f = files.find((x) => x.accountId === d.accountId)
    if (!out.has(d.accountId) || !f || d.platform === null || d.format === null) return []
    const cover =
      // Facebook takes the first frame of a reel: the cover chosen goes only to Instagram
      f.cover === null || f.platform === 'facebook'
        ? null
        : {
            mediaId: f.cover.mediaId,
            copyId: copies ? (views.get(copyKey(f.cover))?.copy?.id ?? null) : null,
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
  // «the copies were taken away» only once something went out: before, they are on their way
  const published = input.targets.some((t) => t.publishedAt !== null)
  return {
    originals: input.mayReadFiles && published && all.some((v) => v.copy === null),
    versions,
  }
}

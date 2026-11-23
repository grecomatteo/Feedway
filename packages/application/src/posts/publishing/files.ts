import type { CopyRequest, RuleReport } from '@app/domain'
import { publishCopiesOf, requestPublishCopies } from '../../media/index.js'
import type { CoverImage, PublishFiles } from '../../ports/platform-publisher.js'
import type { Storage } from '../../ports/storage.js'
import type { PostRecord } from '../../ports/posts.js'
import type { Tx } from '../../ports/tx.js'
import { publishFilesOfPost } from '../../rules/index.js'
import { toCheckInput } from '../to-check-input.js'
import { publicFileUrl, type PublishingWorkerDeps } from './context.js'

// The copies a destination publishes (plan 07 Task 6, Scelta 4), read when it is prepared and
// when it is published: each one ready with its public address, or why not yet.

export type DestinationCopies =
  | { status: 'ready'; files: PublishFiles }
  /** still being made, or asked for again now: the worker is woken by the caller */
  | { status: 'pending'; asked: number }
  | { status: 'failed' }
  /** PUBLIC_URL is not set: Meta reaches no file (review R9), a setting of the server to fix */
  | { status: 'no_public_host' }

export async function destinationCopies(
  tx: Tx,
  deps: Pick<
    PublishingWorkerDeps,
    'platformRules' | 'publicUrl' | 'ids' | 'newPublicToken' | 'storage'
  >,
  post: PostRecord,
  report: RuleReport,
  accountId: string,
): Promise<DestinationCopies> {
  const scope = { organizationId: post.organizationId, workspaceId: post.workspaceId }
  const destination = (
    await publishFilesOfPost(tx, deps, scope, toCheckInput(post, 'publish'), report)
  ).find((d) => d.accountId === accountId)
  if (!destination) return { status: 'failed' }
  const requests: CopyRequest[] = [
    ...destination.media,
    ...(destination.cover ? [destination.cover] : []),
  ]
  const states = await publishCopiesOf(tx, post.organizationId, requests)
  if (states.some((s) => s.state.status === 'failed')) return { status: 'failed' }
  const missing = states.filter((s) => s.state.status === 'missing').map((s) => s.request)
  if (missing.length > 0) {
    // a copy never asked for (a post scheduled before stage 7) or thrown away: asked now
    const asked = await requestPublishCopies(
      tx,
      { ids: deps.ids, newPublicToken: deps.newPublicToken },
      scope,
      missing,
    )
    // none could be asked (the copy of a file never processed): it will not come
    return asked === 0 ? { status: 'failed' } : { status: 'pending', asked }
  }
  if (states.some((s) => s.state.status === 'pending')) return { status: 'pending', asked: 0 }
  // without the public host Meta reaches no file: the destination says so, never waits silently
  if (deps.publicUrl === null) return { status: 'no_public_host' }
  const base = deps.publicUrl
  const urls = states.map(({ state }) => {
    if (state.status !== 'ready' || state.copy.publicToken === null)
      throw new Error('copy not ready')
    return {
      kind: state.copy.mime === 'video/mp4' ? ('video' as const) : ('image' as const),
      url: publicFileUrl(base, state.copy.publicToken, state.copy.mime),
      storageKey: state.copy.storageKey,
    }
  })
  const items = urls.slice(0, destination.media.length).map(({ kind, url }) => ({ kind, url }))
  const cover = destination.cover ? urls[destination.media.length] : undefined
  return {
    status: 'ready',
    files: {
      items,
      cover: cover
        ? { url: cover.url, read: () => readCover(deps.storage, cover.storageKey) }
        : null,
    },
  }
}

/** A cover is a small image: a bigger object is not one of ours, and is not sent. */
const COVER_MAX_BYTES = 10 * 1024 * 1024

async function readCover(storage: Pick<Storage, 'get'>, key: string): Promise<CoverImage | null> {
  const object = await storage.get(key)
  if (object === null || object.size > COVER_MAX_BYTES) return null
  const parts: Uint8Array[] = []
  let size = 0
  for await (const part of object.body) {
    size += part.byteLength
    if (size > COVER_MAX_BYTES) return null
    parts.push(part)
  }
  return { bytes: Buffer.concat(parts), contentType: object.contentType }
}

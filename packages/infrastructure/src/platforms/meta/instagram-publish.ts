import {
  PublishError,
  type FoundPost,
  type PlatformPublisher,
  type PublishFile,
  type PublishFiles,
  type PublishTarget,
  type StepContext,
  type StepResult,
  type VerifyResult,
} from '@app/application'
import type { MetaUsage } from '@app/domain/platforms/meta'
import { z } from 'zod'
import { MetaError } from './errors.js'
import type { MetaContainerStatus, MetaTokenCredentials } from './graph-client.js'
import {
  classified,
  FIND_WINDOW_MS,
  normalizeCaption,
  publishErrorOf,
  stepUsage,
  tokenCredentials,
  type MetaPublisherDeps,
} from './publish-support.js'

// Instagram's content publishing (spec §8.5, plan 07 Task 4): containers, then `media_publish`.
// Written from Meta's guide and reference; not verified on the real Graph API
// (docs/platforms/meta.md §Pubblicazione).

/** A container is gone after 24 hours (§8.7). */
const CONTAINER_LIFETIME_MS = 24 * 3_600_000
/** Its state is read at most once a minute (§8.7). */
const STATUS_INTERVAL_MS = 60_000
/** The uncertain search reads this many latest posts (Scelta 7). */
const FIND_LIMIT = 25
/** When the quota's window cannot be read from the account's posts. */
const QUOTA_FALLBACK_MS = 3_600_000

const containerSchema = z.object({ id: z.string(), finished: z.boolean() })

/** What `post_targets.meta_ids` holds for an Instagram destination. */
const idsSchema = z.object({
  platform: z.literal('instagram'),
  /** When the first container of this round was made: the round expires 24 hours later. */
  createdAt: z.iso.datetime(),
  children: z.array(containerSchema),
  container: containerSchema.nullable(),
  /** The last read of each container's state. */
  checkedAt: z.record(z.string(), z.iso.datetime()),
  mediaId: z.string().nullable(),
})
type InstagramIds = z.infer<typeof idsSchema>

const freshIds = (now: Date): InstagramIds => ({
  platform: 'instagram',
  createdAt: now.toISOString(),
  children: [],
  container: null,
  checkedAt: {},
  mediaId: null,
})

/** Back to the start of a round: the containers expired (or never finished). */
class ContainersGone extends Error {}

const productOf = (target: PublishTarget) =>
  target.type === 'reel' ? 'REELS' : target.type === 'story' ? 'STORY' : 'FEED'

export function createInstagramPublisher(deps: MetaPublisherDeps): PlatformPublisher {
  const { client, clock } = deps

  const parse = (target: PublishTarget): InstagramIds | null => {
    const parsed = idsSchema.safeParse(target.metaIds)
    return parsed.success ? parsed.data : null
  }
  const expired = (ids: InstagramIds) =>
    clock.now().getTime() - new Date(ids.createdAt).getTime() >= CONTAINER_LIFETIME_MS

  function fileParams(file: PublishFile): Record<string, string> {
    return file.kind === 'image' ? { image_url: file.url } : { video_url: file.url }
  }

  function containerParams(target: PublishTarget, files: PublishFiles): Record<string, string> {
    const caption = target.caption === '' ? {} : { caption: target.caption }
    const [first] = files.items
    if (first === undefined) throw new Error('a destination without files cannot be prepared')
    switch (target.type) {
      case 'photo':
        return { image_url: first.url, ...caption }
      case 'story':
        return { media_type: 'STORIES', ...fileParams(first) }
      case 'reel': {
        const cover =
          files.cover === null
            ? {}
            : 'url' in files.cover
              ? { cover_url: files.cover.url }
              : { thumb_offset: String(files.cover.offsetMs) }
        return {
          media_type: 'REELS',
          video_url: first.url,
          share_to_feed: String(target.shareToFeed),
          ...cover,
          ...caption,
        }
      }
      case 'carousel':
        throw new Error('a carousel is made of children')
    }
  }

  /**
   * Reads a container's state once if a minute passed since the last read. `null`: too early.
   * `ContainersGone` when it expired; a `PublishError` when Meta could not process it.
   */
  async function readStatus(
    credentials: MetaTokenCredentials,
    ids: InstagramIds,
    id: string,
    signal: AbortSignal,
  ): Promise<{ status: MetaContainerStatus['statusCode']; usage: MetaUsage } | null> {
    const last = ids.checkedAt[id]
    const now = clock.now()
    if (last !== undefined && now.getTime() - new Date(last).getTime() < STATUS_INTERVAL_MS)
      return null
    const read = await classified(clock, () => client.getContainerStatus(credentials, id, signal), {
      uncertainAs: 'transient',
    })
    ids.checkedAt[id] = now.toISOString()
    const status = read.data.statusCode
    if (status === 'EXPIRED') throw new ContainersGone()
    // the post is out already (a publish whose answer was lost): never make another one
    if (status === 'PUBLISHED') throw new PublishError({ kind: 'uncertain', code: 'meta_error' })
    if (status === 'ERROR')
      throw new PublishError({
        kind: 'permanent',
        code: 'media_rejected',
        platformCode: read.data.status?.match(/\d{7}/)?.[0] ?? null,
      })
    return { status, usage: read.usage }
  }

  const nextRead = (ids: InstagramIds, id: string) =>
    new Date(new Date(ids.checkedAt[id] ?? clock.now()).getTime() + STATUS_INTERVAL_MS)

  async function prepareRound(
    target: PublishTarget,
    files: PublishFiles,
    ctx: StepContext,
    ids: InstagramIds,
  ): Promise<StepResult> {
    const credentials = tokenCredentials(target.credentials)
    const ig = target.account.externalId
    let usage: MetaUsage = { app: null, business: [] }
    const create = async (params: Record<string, string>) => {
      const made = await classified(
        clock,
        () => client.createInstagramContainer(credentials, ig, params, ctx.signal),
        // a container that may exist costs nothing: it expires by itself (no post comes out)
        { uncertainAs: 'transient' },
      )
      usage = made.usage
      return made.data.id
    }
    const wait = (id: string): StepResult => ({
      outcome: 'wait',
      reason: 'processing',
      metaIds: ids,
      retryAt: nextRead(ids, id),
      ...stepUsage(usage),
    })
    /** true: finished; false: still working, wait for the next read. */
    const finish = async (container: { id: string; finished: boolean }) => {
      if (container.finished) return true
      const read = await readStatus(credentials, ids, container.id, ctx.signal)
      if (read === null) return false
      usage = read.usage
      container.finished = read.status === 'FINISHED'
      await ctx.saveIds(ids)
      return container.finished
    }

    if (target.type === 'carousel') {
      for (const [i, file] of files.items.entries()) {
        if (ids.children[i] !== undefined) continue
        const id = await create({
          is_carousel_item: 'true',
          // the carousel's video items: `media_type=VIDEO` (not verified)
          ...(file.kind === 'video' ? { media_type: 'VIDEO' } : {}),
          ...fileParams(file),
        })
        // an image is ready at once; a video is read before the carousel is made
        ids.children.push({ id, finished: file.kind === 'image' })
        await ctx.saveIds(ids)
      }
      for (const child of ids.children) if (!(await finish(child))) return wait(child.id)
      if (ids.container === null) {
        const id = await create({
          media_type: 'CAROUSEL',
          children: ids.children.map((c) => c.id).join(','),
          ...(target.caption === '' ? {} : { caption: target.caption }),
        })
        ids.container = { id, finished: false }
        await ctx.saveIds(ids)
      }
    } else if (ids.container === null) {
      const id = await create(containerParams(target, files))
      ids.container = { id, finished: false }
      await ctx.saveIds(ids)
    }
    if (!(await finish(ids.container))) return wait(ids.container.id)
    return {
      outcome: 'done',
      metaIds: ids,
      externalPostId: null,
      permalink: null,
      ...stepUsage(usage),
    }
  }

  /** When a slot frees up: the oldest post of the window leaves it (Meta does not say). */
  async function quotaFreesAt(
    credentials: MetaTokenCredentials,
    target: PublishTarget,
    windowSeconds: number,
    signal: AbortSignal,
  ): Promise<Date> {
    const now = clock.now().getTime()
    const fallback = new Date(now + QUOTA_FALLBACK_MS)
    try {
      const recent = await client.listInstagramMedia(
        credentials,
        target.account.externalId,
        { edge: 'media', limit: 50 },
        signal,
      )
      const times = recent.data
        .map((m) => m.timestamp?.getTime())
        .filter((t): t is number => t !== undefined && t > now - windowSeconds * 1000)
      if (times.length === 0) return fallback
      return new Date(Math.max(Math.min(...times) + windowSeconds * 1000, now + STATUS_INTERVAL_MS))
    } catch (err) {
      if (err instanceof MetaError) return fallback
      throw err
    }
  }

  return {
    async prepare(target, files, ctx) {
      const known = parse(target)
      let ids = known === null || expired(known) ? freshIds(clock.now()) : known
      if (ids !== known) await ctx.saveIds(ids)
      try {
        return await prepareRound(target, files, ctx, ids)
      } catch (err) {
        if (!(err instanceof ContainersGone)) throw err
      }
      // expired while waiting: one new round from the start (§9.5), then the worker waits
      ids = freshIds(clock.now())
      await ctx.saveIds(ids)
      try {
        return await prepareRound(target, files, ctx, ids)
      } catch (err) {
        if (err instanceof ContainersGone)
          throw new PublishError({ kind: 'transient', code: 'meta_error' })
        throw err
      }
    },

    async publish(target, ctx) {
      const ids = parse(target)
      const noUsage = stepUsage({ app: null, business: [] })
      // published already: never twice (§9.5)
      if (target.externalPostId !== null || (ids?.mediaId ?? null) !== null)
        return {
          outcome: 'done',
          metaIds: ids ?? {},
          externalPostId: target.externalPostId ?? ids?.mediaId ?? null,
          permalink: null,
          ...noUsage,
        }
      if (ids?.container?.finished !== true || expired(ids))
        return { outcome: 'expired', metaIds: freshIds(clock.now()), ...noUsage }
      const credentials = tokenCredentials(target.credentials)
      const ig = target.account.externalId
      const limit = await classified(
        clock,
        () => client.getPublishingLimit(credentials, ig, ctx.signal),
        { uncertainAs: 'transient' },
      )
      const quotaWait = async (usage: MetaUsage): Promise<StepResult> => ({
        outcome: 'wait',
        reason: 'quota',
        metaIds: ids,
        retryAt: await quotaFreesAt(
          credentials,
          target,
          limit.data.quotaDurationSeconds,
          ctx.signal,
        ),
        ...stepUsage(usage),
      })
      if (limit.data.quotaUsage >= limit.data.quotaTotal) return quotaWait(limit.usage)
      const container = ids.container.id
      try {
        const published = await client.publishInstagramContainer(
          credentials,
          ig,
          container,
          ctx.signal,
        )
        ids.mediaId = published.data.id
        await ctx.saveIds(ids)
        return {
          outcome: 'done',
          metaIds: ids,
          externalPostId: published.data.id,
          permalink: null,
          ...stepUsage(published.usage),
        }
      } catch (err) {
        if (!(err instanceof MetaError)) throw err
        if (err.reason === 'container_expired')
          return {
            outcome: 'expired',
            metaIds: freshIds(clock.now()),
            ...stepUsage(err.usage ?? limit.usage),
          }
        if (err.reason === 'quota_exhausted') return quotaWait(err.usage ?? limit.usage)
        throw publishErrorOf(err, clock.now())
      }
    },

    async findPublished(target, since, signal) {
      const credentials = tokenCredentials(target.credentials)
      const story = target.type === 'story'
      const found = await classified(clock, () =>
        client.listInstagramMedia(
          credentials,
          target.account.externalId,
          { edge: story ? 'stories' : 'media', limit: FIND_LIMIT },
          signal,
        ),
      )
      // Meta's timestamps have whole seconds
      const from = Math.floor(since.getTime() / 1000) * 1000
      const to = since.getTime() + FIND_WINDOW_MS
      const caption = normalizeCaption(target.caption)
      const match = found.data.find((m) => {
        const at = m.timestamp?.getTime()
        if (at === undefined || at < from || at > to) return false
        if (story) return m.mediaProductType === 'STORY'
        return normalizeCaption(m.caption ?? '') === caption
      })
      if (match?.timestamp == null) return null
      return {
        externalPostId: match.id,
        permalink: match.permalink,
        publishedAt: match.timestamp,
      } satisfies FoundPost
    },

    async verify(target, signal): Promise<VerifyResult> {
      if (target.externalPostId === null)
        return {
          outcome: 'problem',
          reason: 'not_found',
          ...stepUsage({ app: null, business: [] }),
        }
      const credentials = tokenCredentials(target.credentials)
      let read
      try {
        read = await client.getInstagramMedia(credentials, target.externalPostId, signal)
      } catch (err) {
        if (err instanceof MetaError && err.reason === 'not_found_or_forbidden')
          return {
            outcome: 'problem',
            reason: 'not_found',
            ...stepUsage(err.usage ?? { app: null, business: [] }),
          }
        if (err instanceof MetaError)
          throw publishErrorOf(err, clock.now(), {
            uncertainAs: 'transient',
          })
        throw err
      }
      const media = read.data
      const usage = stepUsage(read.usage)
      const product = media.mediaProductType
      const typeOk =
        (product === null || product === productOf(target)) &&
        (target.type !== 'carousel' || media.mediaType === 'CAROUSEL_ALBUM') &&
        (target.type !== 'photo' || media.mediaType === 'IMAGE')
      if (!typeOk) return { outcome: 'problem', reason: 'wrong_type', ...usage }
      // a story may come without a link: it expires in 24 hours, its id is enough (§9.6)
      if (media.permalink === null && target.type !== 'story')
        return { outcome: 'pending', ...usage }
      return { outcome: 'confirmed', permalink: media.permalink, ...usage }
    },
  }
}

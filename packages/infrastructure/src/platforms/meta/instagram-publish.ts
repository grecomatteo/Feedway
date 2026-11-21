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
import type {
  MetaContainerStatus,
  MetaInstagramMedia,
  MetaTokenCredentials,
} from './graph-client.js'
import {
  classified,
  FIND_WINDOW_MS,
  normalizeCaption,
  publishCallError,
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

/** Meta's ids are digits; `dry-run-…` in `META_MODE=dry-run`. Never a dot, a slash or a comma. */
const metaId = z.string().regex(/^[0-9A-Za-z_-]{1,64}$/)
const containerSchema = z.object({ id: metaId, finished: z.boolean() })

/** What `post_targets.meta_ids` holds for an Instagram destination. */
const idsSchema = z.object({
  platform: z.literal('instagram'),
  /** When the first container of this round was made: the round expires 24 hours later. */
  createdAt: z.iso.datetime(),
  children: z.array(containerSchema),
  container: containerSchema.nullable(),
  /** The last read of each container's state. */
  checkedAt: z.record(z.string(), z.iso.datetime()),
  mediaId: metaId.nullable(),
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

/** The published media is of the destination's type (§9.6); a field Meta left out passes. */
function typeMatches(target: PublishTarget, media: MetaInstagramMedia): boolean {
  const product = media.mediaProductType
  return (
    (product === null || product === productOf(target)) &&
    (target.type !== 'carousel' || media.mediaType === 'CAROUSEL_ALBUM') &&
    (target.type !== 'photo' || media.mediaType === null || media.mediaType === 'IMAGE')
  )
}

/** Only Instagram's own https links are kept: the panel shows them as links. */
function safePermalink(value: string | null): string | null {
  if (value === null) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && /^(www\.)?instagram\.com$/.test(url.hostname)
      ? url.toString()
      : null
  } catch {
    return null
  }
}

/** Saved ids that do not read as ours but say a post came out: never start again from them. */
const hasMediaId = (ids: unknown) =>
  typeof ids === 'object' &&
  ids !== null &&
  typeof (ids as { mediaId?: unknown }).mediaId === 'string'

/** The search starts a little before the step: the two clocks may not agree (Scelta 7). */
const CLOCK_SKEW_MS = 2 * 60_000

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
        platformCode: read.data.status?.match(/\b2207\d{3}\b/)?.[0] ?? null,
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

  /**
   * The finished container of an old round was never published (review R15). Published: the
   * post is out and only a person can tell where, so the destination fails with the reason that
   * says to look at the profile; a container Meta no longer has is gone, a new round starts.
   */
  async function assertNotPublished(
    credentials: MetaTokenCredentials,
    ids: InstagramIds,
    signal: AbortSignal,
  ): Promise<void> {
    const old = ids.container
    if (old === null || !old.finished) return
    let status: MetaContainerStatus['statusCode']
    try {
      status = (await client.getContainerStatus(credentials, old.id, signal)).data.statusCode
    } catch (err) {
      if (err instanceof MetaError && err.reason === 'not_found_or_forbidden') return
      if (err instanceof MetaError)
        throw publishErrorOf(err, clock.now(), { uncertainAs: 'transient' })
      throw err
    }
    if (status === 'PUBLISHED')
      throw new PublishError({ kind: 'permanent', code: 'uncertain_not_found' })
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
      // the post is out already: nothing to prepare, and the ids that say so are never dropped
      if (known?.mediaId != null)
        return {
          outcome: 'done',
          metaIds: known,
          externalPostId: null,
          permalink: null,
          ...stepUsage({ app: null, business: [] }),
        }
      if (known === null && hasMediaId(target.metaIds))
        throw new PublishError({ kind: 'uncertain', code: 'meta_error' })
      // a round gone past its 24 hours (a «Riprova» the day after an uncertain call): its
      // container is read first, as `publish` does, never made again over a post that is out
      if (known !== null && expired(known))
        await assertNotPublished(tokenCredentials(target.credentials), known, ctx.signal)
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

    async publish(target, _files, ctx) {
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
      const credentials = tokenCredentials(target.credentials)
      const ig = target.account.externalId
      /**
       * Prepare again, unless the old container says it was published (an answer lost on the
       * way): then the post may be out, and only the search can tell (§9.5).
       */
      const prepareAgain = async (usage: MetaUsage): Promise<StepResult> => {
        const old = ids?.container?.id
        if (old !== undefined) {
          let status: MetaContainerStatus['statusCode']
          try {
            status = (await client.getContainerStatus(credentials, old, ctx.signal)).data.statusCode
          } catch (err) {
            if (err instanceof MetaError)
              throw new PublishError({ kind: 'uncertain', code: 'meta_error' })
            throw err
          }
          if (status === 'PUBLISHED')
            throw new PublishError({ kind: 'uncertain', code: 'meta_error' })
        }
        return { outcome: 'expired', metaIds: freshIds(clock.now()), ...stepUsage(usage) }
      }
      if (ids?.container == null)
        return { outcome: 'expired', metaIds: freshIds(clock.now()), ...noUsage }
      if (!ids.container.finished || expired(ids)) return prepareAgain(noUsage.usage as MetaUsage)
      const limit = await classified(
        clock,
        () => client.getPublishingLimit(credentials, ig, ctx.signal),
        { uncertainAs: 'transient' },
      )
      // the quota as read, with this post once it is out (`account.quota_low`)
      const quota = (published: number) => ({
        used: Math.min(limit.data.quotaTotal, limit.data.quotaUsage + published),
        total: limit.data.quotaTotal,
        windowSeconds: limit.data.quotaDurationSeconds,
      })
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
        quota: { ...quota(0), used: limit.data.quotaTotal },
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
        try {
          await ctx.saveIds(ids)
        } catch {
          // the post is out: the result carries the ids, the worker saves them with the outcome
        }
        return {
          outcome: 'done',
          metaIds: ids,
          externalPostId: published.data.id,
          permalink: null,
          ...stepUsage(published.usage),
          quota: quota(1),
        }
      } catch (err) {
        if (!(err instanceof MetaError)) throw err
        if (err.reason === 'container_expired') return prepareAgain(err.usage ?? limit.usage)
        if (err.reason === 'quota_exhausted') return quotaWait(err.usage ?? limit.usage)
        // only a refusal that says Meta did nothing is safe to try again; a server error or an
        // unreadable answer may come after the post went out (D-105.11)
        throw publishCallError(err, clock.now())
      }
    },

    // a container never published expires by itself in 24 hours (plan 07, P2)
    discard: () => Promise.resolve(),

    // the same container: Meta never publishes it twice, a post already out says so (D-112.8)
    idsAfterNotFound: (metaIds) => metaIds,

    async findPublished(target, since, signal, exclude = []) {
      const credentials = tokenCredentials(target.credentials)
      const story = target.type === 'story'
      const found = await classified(
        clock,
        () =>
          client.listInstagramMedia(
            credentials,
            target.account.externalId,
            { edge: story ? 'stories' : 'media', limit: FIND_LIMIT },
            signal,
          ),
        // a failed search is only a search to do again
        { uncertainAs: 'transient' },
      )
      const from = since.getTime() - CLOCK_SKEW_MS
      const to = since.getTime() + FIND_WINDOW_MS
      const caption = normalizeCaption(target.caption)
      const others = new Set(exclude)
      const fits = found.data.filter((m) => {
        const at = m.timestamp?.getTime()
        if (at === undefined || at < from || at > to || !typeMatches(target, m)) return false
        if (others.has(m.id)) return false
        return story || normalizeCaption(m.caption ?? '') === caption
      })
      // two that fit (stories have no text, a twin post of the client): not sure, a person looks
      const [match] = fits
      if (fits.length !== 1 || match?.timestamp == null) return null
      return {
        externalPostId: match.id,
        permalink: safePermalink(match.permalink),
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
      if (!typeMatches(target, media)) return { outcome: 'problem', reason: 'wrong_type', ...usage }
      // a story may come without a link: it expires in 24 hours, its id is enough (§9.6)
      const permalink = safePermalink(media.permalink)
      if (permalink === null && target.type !== 'story') return { outcome: 'pending', ...usage }
      return { outcome: 'confirmed', permalink, ...usage }
    },
  }
}

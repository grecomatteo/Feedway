import {
  PublishError,
  type FoundPost,
  type PlatformPublisher,
  type PublishFiles,
  type PublishTarget,
  type StepContext,
  type StepResult,
  type VerifyResult,
} from '@app/application'
import type { MetaUsage } from '@app/domain/platforms/meta'
import { z } from 'zod'
import { MetaError } from './errors.js'
import type { MetaFacebookPost, MetaResult, MetaTokenCredentials } from './graph-client.js'
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

// Publishing on a Facebook Page (spec §8.5, plan 07 Task 5), with the Page token read at every
// step and never kept. Written from Meta's reference and guides; not verified on the real
// Graph API (docs/platforms/meta.md §Pubblicazione, D-106).

/**
 * Unpublished photos and upload sessions are kept about a day (Page photos reference): a round
 * older than this is prepared again rather than risk a post with photos Meta dropped (D-106).
 */
const PREPARED_LIFETIME_MS = 23 * 3_600_000
/** The uncertain search reads this many latest posts (Scelta 7). */
const FIND_LIMIT = 25
/** The search starts a little before the step: the two clocks may not agree (Scelta 7). */
const CLOCK_SKEW_MS = 2 * 60_000

/** Meta's ids, and a Page post's `{page}_{post}`; `dry-run-…` in `META_MODE=dry-run`. */
const metaId = z.string().regex(/^[0-9A-Za-z_-]{1,64}$/)

/** What `post_targets.meta_ids` holds for a Facebook destination. */
const idsSchema = z.object({
  platform: z.literal('facebook'),
  /** When this round began: what it left on Meta is dropped after a day. */
  createdAt: z.iso.datetime(),
  /** Unpublished photos: the items of a multi-photo post, or the photo of a story. */
  photos: z.array(metaId),
  /** The upload session of a reel or a video story. */
  video: z.object({ id: metaId, uploaded: z.boolean() }).nullable(),
  /** The published post, video or story. */
  postId: metaId.nullable(),
})
type FacebookIds = z.infer<typeof idsSchema>

const freshIds = (now: Date): FacebookIds => ({
  platform: 'facebook',
  createdAt: now.toISOString(),
  photos: [],
  video: null,
  postId: null,
})

/**
 * How a destination goes out on a Page. `photo` and `video` are one call that publishes, with
 * nothing to prepare; the others leave photos or an upload on Meta first.
 */
type Shape = 'photo' | 'multi_photo' | 'reel' | 'video' | 'photo_story' | 'video_story'

function shapeOf(
  target: PublishTarget,
  files: PublishFiles | null,
  ids: FacebookIds | null,
): Shape {
  switch (target.type) {
    case 'photo':
      return 'photo'
    case 'carousel':
      return 'multi_photo'
    case 'reel':
      return target.asVideo ? 'video' : 'reel'
    case 'story': {
      const kind = files?.items[0]?.kind ?? (ids?.video == null ? 'image' : 'video')
      return kind === 'video' ? 'video_story' : 'photo_story'
    }
  }
}

/** Only Facebook's own https links are kept; a path (`/reel/…`) is completed. */
function safePermalink(value: string | null): string | null {
  if (value === null) return null
  try {
    const url = new URL(value, 'https://www.facebook.com')
    return url.protocol === 'https:' && /^((www|m|web)\.)?facebook\.com$/.test(url.hostname)
      ? url.toString()
      : null
  } catch {
    return null
  }
}

/** Saved ids that do not read as ours but say a post came out: never start again from them. */
const hasPostId = (ids: unknown) =>
  typeof ids === 'object' &&
  ids !== null &&
  typeof (ids as { postId?: unknown }).postId === 'string'

const NO_USAGE: MetaUsage = { app: null, business: [] }

const optionalText = (key: string, text: string) => (text === '' ? {} : { [key]: text })

export function createFacebookPublisher(deps: MetaPublisherDeps): PlatformPublisher {
  const { client, clock } = deps

  const parse = (target: PublishTarget): FacebookIds | null => {
    const parsed = idsSchema.safeParse(target.metaIds)
    return parsed.success ? parsed.data : null
  }
  const expired = (ids: FacebookIds) =>
    clock.now().getTime() - new Date(ids.createdAt).getTime() >= PREPARED_LIFETIME_MS
  const pageOf = (target: PublishTarget) => target.account.pageId ?? target.account.externalId

  /** The Page token, read with the connection's token for this step only (§8.5). */
  async function pageCredentials(
    target: PublishTarget,
    signal: AbortSignal,
  ): Promise<MetaTokenCredentials> {
    const credentials = tokenCredentials(target.credentials)
    const read = await classified(
      clock,
      () => client.getPageAccessToken(credentials, pageOf(target), signal),
      { uncertainAs: 'transient' },
    )
    // no token: the connection has no task on the Page (it was taken away in the Business)
    if (read.data.accessToken === null)
      throw new PublishError({ kind: 'permanent', code: 'permission_missing' })
    return { accessToken: read.data.accessToken, appSecret: credentials.appSecret }
  }

  /** A call before the one that publishes: what it may have left on Meta is never a post. */
  const before = <T>(run: () => Promise<MetaResult<T>>) =>
    classified(clock, run, { uncertainAs: 'transient' })

  async function prepareRound(
    target: PublishTarget,
    files: PublishFiles,
    ctx: StepContext,
    ids: FacebookIds,
  ): Promise<StepResult> {
    const shape = shapeOf(target, files, ids)
    let usage: MetaUsage = NO_USAGE
    const done = (): StepResult => ({
      outcome: 'done',
      metaIds: ids,
      externalPostId: null,
      permalink: null,
      ...stepUsage(usage),
    })
    // one call publishes these: the file is fetched by Meta then (§8.5)
    if (shape === 'photo' || shape === 'video') return done()
    const page = pageOf(target)
    const credentials = await pageCredentials(target, ctx.signal)

    if (shape === 'multi_photo' || shape === 'photo_story') {
      const items = shape === 'photo_story' ? files.items.slice(0, 1) : files.items
      for (const [i, file] of items.entries()) {
        if (ids.photos[i] !== undefined) continue
        // a Page post holds only photos: the post's rules leave the videos out (D-51)
        if (file.kind !== 'image')
          throw new PublishError({ kind: 'permanent', code: 'media_rejected' })
        const made = await before(() =>
          client.createPagePhoto(
            credentials,
            page,
            { url: file.url, published: 'false' },
            ctx.signal,
          ),
        )
        usage = made.usage
        ids.photos.push(made.data.id)
        await ctx.saveIds(ids)
      }
      return done()
    }

    const [file] = files.items
    if (file?.kind !== 'video') throw new Error('a reel or a video story needs its video')
    const edge = shape === 'reel' ? 'video_reels' : 'video_stories'
    if (ids.video === null) {
      const started = await before(() =>
        client.startPageVideoUpload(credentials, page, edge, ctx.signal),
      )
      usage = started.usage
      ids.video = { id: started.data.videoId, uploaded: false }
      await ctx.saveIds(ids)
    }
    if (!ids.video.uploaded) {
      const video = ids.video
      const sent = await before(() =>
        client.uploadHostedVideo(credentials, video.id, file.url, ctx.signal),
      )
      usage = sent.usage
      if (!sent.data.success) throw new PublishError({ kind: 'transient', code: 'meta_error' })
      video.uploaded = true
      await ctx.saveIds(ids)
    }
    return done()
  }

  /** The search's candidates: the Page's posts, videos, reels or stories. */
  async function candidates(
    credentials: MetaTokenCredentials,
    target: PublishTarget,
    shape: Shape,
    signal: AbortSignal,
  ): Promise<MetaFacebookPost[]> {
    const page = pageOf(target)
    if (shape === 'photo_story' || shape === 'video_story') {
      const stories = await before(() =>
        client.listPageStories(credentials, page, FIND_LIMIT, signal),
      )
      const kind = shape === 'video_story' ? 'video' : 'photo'
      return stories.data
        .filter((s) => s.mediaType === null || s.mediaType === kind)
        .map((s) => ({
          id: s.postId,
          message: null,
          createdAt: s.createdAt,
          isPublished: true,
          permalink: s.permalink,
        }))
    }
    const edge = shape === 'reel' ? 'video_reels' : shape === 'video' ? 'videos' : 'published_posts'
    const list = await before(() =>
      client.listPagePublished(credentials, page, { edge, limit: FIND_LIMIT }, signal),
    )
    return list.data
  }

  return {
    async prepare(target, files, ctx) {
      const known = parse(target)
      // the post is out already: nothing to prepare, and the ids that say so are never dropped
      if (known?.postId != null)
        return {
          outcome: 'done',
          metaIds: known,
          externalPostId: null,
          permalink: null,
          ...stepUsage(NO_USAGE),
        }
      if (known === null && hasPostId(target.metaIds))
        throw new PublishError({ kind: 'uncertain', code: 'meta_error' })
      const ids = known === null || expired(known) ? freshIds(clock.now()) : known
      if (ids !== known) await ctx.saveIds(ids)
      return prepareRound(target, files, ctx, ids)
    },

    async publish(target, files, ctx) {
      const known = parse(target)
      // published already: never twice (§9.5)
      if (target.externalPostId !== null || (known?.postId ?? null) !== null)
        return {
          outcome: 'done',
          metaIds: known ?? {},
          externalPostId: target.externalPostId ?? known?.postId ?? null,
          permalink: null,
          ...stepUsage(NO_USAGE),
        }
      if (known === null && hasPostId(target.metaIds))
        throw new PublishError({ kind: 'uncertain', code: 'meta_error' })
      const shape = shapeOf(target, files, known)
      const oneCall = shape === 'photo' || shape === 'video'
      const again = (): StepResult => ({
        outcome: 'expired',
        metaIds: freshIds(clock.now()),
        ...stepUsage(NO_USAGE),
      })
      // what prepare left is missing or too old: prepare again (the files are fetched again)
      if (!oneCall && (known === null || expired(known))) return again()
      const ids = known ?? freshIds(clock.now())
      const prepared =
        oneCall ||
        ((shape === 'multi_photo' || shape === 'photo_story') && ids.photos.length > 0) ||
        ids.video?.uploaded === true
      if (!prepared) return again()

      const page = pageOf(target)
      const credentials = await pageCredentials(target, ctx.signal)
      let out: { id: string | null; usage: MetaUsage }
      try {
        out = await publishCall(credentials, page, target, files, shape, ids, ctx.signal)
      } catch (err) {
        if (err instanceof MetaError) throw publishCallError(err, clock.now())
        throw err
      }
      // Meta said yes without the id: the post is out, only the search can name it
      if (out.id === null) throw new PublishError({ kind: 'uncertain', code: 'meta_error' })
      ids.postId = out.id
      try {
        await ctx.saveIds(ids)
      } catch {
        // the post is out: the result carries the ids, the worker saves them with the outcome
      }
      return {
        outcome: 'done',
        metaIds: ids,
        externalPostId: out.id,
        permalink: null,
        ...stepUsage(out.usage),
      }
    },

    async discard(target, signal) {
      const ids = parse(target)
      if (ids === null || ids.postId !== null || target.externalPostId !== null) return
      const objects = [...ids.photos, ...(ids.video === null ? [] : [ids.video.id])]
      if (objects.length === 0) return
      const credentials = await pageCredentials(target, signal)
      for (const id of objects) {
        try {
          await client.deleteObject(credentials, id, signal)
        } catch (err) {
          // gone already (Meta dropped it after a day): thrown away all the same
          if (err instanceof MetaError && err.reason === 'not_found_or_forbidden') continue
          if (err instanceof MetaError)
            throw publishErrorOf(err, clock.now(), { uncertainAs: 'transient' })
          throw err
        }
      }
    },

    async findPublished(target, since, signal) {
      const ids = parse(target)
      const shape = shapeOf(target, null, ids)
      const credentials = await pageCredentials(target, signal)
      const found = await candidates(credentials, target, shape, signal)
      const from = since.getTime() - CLOCK_SKEW_MS
      const to = since.getTime() + FIND_WINDOW_MS
      const caption = normalizeCaption(target.caption)
      const story = shape === 'photo_story' || shape === 'video_story'
      const match = found.find((p) => {
        // the reel's own upload session: it is that reel, whatever its text
        if (ids?.video != null && p.id === ids.video.id) return p.createdAt !== null
        const at = p.createdAt?.getTime()
        if (at === undefined || at < from || at > to) return false
        return story || normalizeCaption(p.message ?? '') === caption
      })
      if (match?.createdAt == null) return null
      return {
        externalPostId: match.id,
        permalink: safePermalink(match.permalink),
        publishedAt: match.createdAt,
      } satisfies FoundPost
    },

    async verify(target, signal): Promise<VerifyResult> {
      const postId = target.externalPostId
      if (postId === null)
        return { outcome: 'problem', reason: 'not_found', ...stepUsage(NO_USAGE) }
      const shape = shapeOf(target, null, parse(target))
      const credentials = await pageCredentials(target, signal)
      try {
        if (shape === 'photo_story' || shape === 'video_story') {
          // a story is checked by its id among the Page's stories (§9.6): it expires in a day
          const read = await client.listPageStories(credentials, pageOf(target), FIND_LIMIT, signal)
          const usage = stepUsage(read.usage)
          const story = read.data.find((s) => s.postId === postId)
          if (story === undefined) return { outcome: 'problem', reason: 'not_found', ...usage }
          return { outcome: 'confirmed', permalink: safePermalink(story.permalink), ...usage }
        }
        if (shape === 'reel' || shape === 'video') {
          const read = await client.getFacebookVideo(credentials, postId, signal)
          const usage = stepUsage(read.usage)
          const v = read.data
          if (
            v.videoStatus === 'error' ||
            v.videoStatus === 'expired' ||
            v.processingStatus === 'error'
          )
            return { outcome: 'problem', reason: 'failed', ...usage }
          const out =
            v.publishStatus === 'published' ||
            (v.videoStatus === 'ready' && v.publishingStatus === 'complete')
          if (!out) return { outcome: 'pending', ...usage }
          return { outcome: 'confirmed', permalink: safePermalink(v.permalink), ...usage }
        }
        const read = await client.getFacebookPost(credentials, postId, signal)
        const usage = stepUsage(read.usage)
        const permalink = safePermalink(read.data.permalink)
        if (read.data.isPublished === false || permalink === null)
          return { outcome: 'pending', ...usage }
        return { outcome: 'confirmed', permalink, ...usage }
      } catch (err) {
        if (err instanceof MetaError && err.reason === 'not_found_or_forbidden')
          return { outcome: 'problem', reason: 'not_found', ...stepUsage(err.usage ?? NO_USAGE) }
        if (err instanceof MetaError)
          throw publishErrorOf(err, clock.now(), { uncertainAs: 'transient' })
        throw err
      }
    },
  }

  /** The call that publishes, by shape; `id` null when Meta said yes without one. */
  async function publishCall(
    credentials: MetaTokenCredentials,
    page: string,
    target: PublishTarget,
    files: PublishFiles,
    shape: Shape,
    ids: FacebookIds,
    signal: AbortSignal,
  ): Promise<{ id: string | null; usage: MetaUsage }> {
    const [file] = files.items
    switch (shape) {
      case 'photo': {
        if (file?.kind !== 'image') throw new Error('a photo needs its image')
        // `caption`: the reference calls `message` deprecated for photos
        const made = await client.createPagePhoto(
          credentials,
          page,
          { url: file.url, ...optionalText('caption', target.caption) },
          signal,
        )
        // the post is what the panel links and checks; the photo id only if Meta gave no post
        return { id: made.data.postId ?? made.data.id, usage: made.usage }
      }
      case 'multi_photo': {
        const attached = Object.fromEntries(
          ids.photos.map((id, i) => [
            `attached_media[${String(i)}]`,
            JSON.stringify({ media_fbid: id }),
          ]),
        )
        const made = await client.createPageFeedPost(
          credentials,
          page,
          { ...optionalText('message', target.caption), ...attached },
          signal,
        )
        return { id: made.data.id, usage: made.usage }
      }
      case 'photo_story': {
        const [photo] = ids.photos
        if (photo === undefined) throw new Error('a photo story needs its photo')
        const made = await client.createPagePhotoStory(credentials, page, photo, signal)
        return { id: made.data.success ? made.data.postId : null, usage: made.usage }
      }
      case 'reel':
      case 'video_story': {
        const video = ids.video
        if (video === null) throw new Error('a reel needs its upload')
        const made = await client.finishPageVideoUpload(
          credentials,
          page,
          shape === 'reel' ? 'video_reels' : 'video_stories',
          shape === 'reel'
            ? {
                video_id: video.id,
                video_state: 'PUBLISHED',
                ...optionalText('description', target.caption),
              }
            : { video_id: video.id },
          signal,
        )
        if (!made.data.success) return { id: null, usage: made.usage }
        // a reel is checked by its video (§9.6); a story by its post
        return { id: shape === 'reel' ? video.id : made.data.postId, usage: made.usage }
      }
      case 'video': {
        if (file?.kind !== 'video') throw new Error('a video needs its file')
        const made = await client.createPageVideo(
          credentials,
          page,
          { file_url: file.url, ...optionalText('description', target.caption) },
          signal,
        )
        return { id: made.data.id, usage: made.usage }
      }
    }
  }
}

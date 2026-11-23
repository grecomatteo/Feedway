import { downloads, metaTime, take, type GraphError, type PublishingAnswer } from './publishing.ts'
import type { ActiveScenario, ScenarioName } from './scenarios.ts'

// The publishing calls of spec §8.5 for a Facebook Page (plan 07, Task 5). Written by hand from
// Meta's reference (Page photos, feed, videos, Reels publishing, Page stories): not verified on
// the real Graph API (docs/platforms/meta.md §Pubblicazione).

type VideoEdge = 'video_reels' | 'video_stories' | 'videos'

interface Photo {
  id: string
  pageId: string
  published: boolean
  /** The post or story that used it: an unpublished photo goes out once. */
  usedIn: string | null
}

interface Video {
  id: string
  pageId: string
  edge: VideoEdge
  uploaded: boolean
  failed: boolean
  pendingReads: number
  /** `upload_phase=finish` (or `POST /videos`): it goes out once processed. */
  finished: boolean
  description: string
  createdAt: Date
}

interface Post {
  id: string
  pageId: string
  message: string
  createdAt: Date
}

interface Story {
  postId: string
  pageId: string
  mediaType: 'photo' | 'video'
  mediaId: string
  createdAt: Date
}

export interface FacebookPublishing {
  /** The Page an object of these calls belongs to; undefined: not ours. */
  ownerOf(id: string): string | undefined
  /** null: not a Facebook publishing call. `tokenSubject`: the node the token stands for. */
  handle(call: {
    method: string
    version: string
    id: string
    edge: string | undefined
    params: URLSearchParams
    tokenSubject: string
  }): Promise<PublishingAnswer | null>
  /** The hosted upload of `rupload.facebook.com` (`file_url` header). */
  upload(call: {
    videoId: string
    fileUrl: string | null
    tokenSubject: string
  }): Promise<PublishingAnswer>
  reset(): void
}

interface Deps {
  scenarios<N extends ScenarioName>(name: N): Extract<ActiveScenario, { name: N }>[]
  isPage(id: string): boolean
  /** The Page token `GET /{page}?fields=access_token` gives, if the fixtures have one. */
  pageToken(pageId: string): string | undefined
}

const DEFAULT_PROCESSING_READS = 3
const DEFAULT_PUBLISH_DELAY_MS = 15_000
const DEFAULT_PAGE = 25

const error = (status: number, e: GraphError): PublishingAnswer => ({ status, error: e })
const paramError = (message: string): PublishingAnswer =>
  error(400, { message: `(#100) ${message}`, type: 'OAuthException', code: 100 })
const notFound = (id: string): PublishingAnswer =>
  error(400, {
    message: `Unsupported request: object with ID '${id}' does not exist or cannot be loaded`,
    type: 'GraphMethodException',
    code: 100,
    error_subcode: 33,
  })
const duplicate = (): PublishingAnswer =>
  error(400, {
    message: '(#506) Duplicate status message',
    type: 'OAuthException',
    code: 506,
  })
const needsPageToken = (): PublishingAnswer =>
  error(403, {
    message: '(#200) This endpoint requires a Page access token',
    type: 'OAuthException',
    code: 200,
  })

export function createFacebookPublishing(deps: Deps): FacebookPublishing {
  const photos = new Map<string, Photo>()
  const videos = new Map<string, Video>()
  const posts = new Map<string, Post>()
  const stories = new Map<string, Story>()
  let counter = 0
  const nextId = (prefix: string) => `${prefix}${String(++counter).padStart(13, '0')}`

  /** The answer of a call that publishes: late, when the scenario says so. */
  function published(body: unknown): PublishingAnswer {
    const late = deps.scenarios('publish_timeout_but_created').find((s) => s.remaining > 0)
    if (late === undefined) return { status: 200, body }
    late.remaining -= 1
    return { status: 200, body, delayMs: late.opts.delayMs ?? DEFAULT_PUBLISH_DELAY_MS }
  }

  const fileDownloads = async (url: string) =>
    !take(deps.scenarios('media_download_failed')) && (await downloads(url))

  function newPost(pageId: string, message: string): Post {
    const post: Post = { id: `${pageId}_${nextId('7100')}`, pageId, message, createdAt: new Date() }
    posts.set(post.id, post)
    return post
  }

  function newStory(pageId: string, mediaType: Story['mediaType'], mediaId: string): Story {
    const story: Story = {
      postId: nextId('7300'),
      pageId,
      mediaType,
      mediaId,
      createdAt: new Date(),
    }
    stories.set(story.postId, story)
    return story
  }

  async function photo(pageId: string, params: URLSearchParams) {
    const url = params.get('url')
    if (url === null) return paramError('The parameter url is required')
    if (!(await fileDownloads(url)))
      return error(400, {
        message: '(#324) Missing or invalid image file',
        type: 'OAuthException',
        code: 324,
      })
    const publish = params.get('published') !== 'false'
    if (publish && take(deps.scenarios('duplicate_post'))) return duplicate()
    const item: Photo = { id: nextId('7200'), pageId, published: publish, usedIn: null }
    photos.set(item.id, item)
    if (!publish) return { status: 200, body: { id: item.id } }
    const post = newPost(pageId, params.get('caption') ?? params.get('message') ?? '')
    item.usedIn = post.id
    return published({ id: item.id, post_id: post.id })
  }

  /** An unpublished photo of the Page, not yet in a post. */
  function unusedPhoto(pageId: string, id: string): Photo | null {
    const item = photos.get(id)
    return item?.pageId === pageId && !item.published && item.usedIn === null ? item : null
  }

  function feed(pageId: string, params: URLSearchParams): PublishingAnswer {
    const attached: Photo[] = []
    for (let i = 0; params.has(`attached_media[${String(i)}]`); i++) {
      let fbid: unknown
      try {
        fbid = (
          JSON.parse(params.get(`attached_media[${String(i)}]`) ?? '') as { media_fbid?: unknown }
        ).media_fbid
      } catch {
        return paramError('attached_media must be JSON')
      }
      const item = typeof fbid === 'string' ? unusedPhoto(pageId, fbid) : null
      if (item === null) return paramError(`Invalid attached media: ${String(fbid)}`)
      attached.push(item)
    }
    const message = params.get('message') ?? ''
    if (attached.length === 0 && message === '')
      return paramError('Either link or message must be supplied')
    if (take(deps.scenarios('duplicate_post'))) return duplicate()
    const post = newPost(pageId, message)
    for (const item of attached) item.usedIn = post.id
    return published({ id: post.id, post_supports_client_mutation_id: true })
  }

  function newVideo(pageId: string, edge: VideoEdge, uploaded: boolean): Video {
    const slow = deps.scenarios('video_processing').find((s) => s.remaining > 0)
    if (slow !== undefined) slow.remaining -= 1
    const video: Video = {
      id: nextId('7400'),
      pageId,
      edge,
      uploaded,
      failed: take(deps.scenarios('video_error')),
      pendingReads: slow === undefined ? 0 : (slow.opts.reads ?? DEFAULT_PROCESSING_READS),
      finished: false,
      description: '',
      createdAt: new Date(),
    }
    videos.set(video.id, video)
    return video
  }

  function phases(
    pageId: string,
    edge: 'video_reels' | 'video_stories',
    version: string,
    params: URLSearchParams,
  ) {
    const phase = params.get('upload_phase')
    if (phase === 'start') {
      const video = newVideo(pageId, edge, false)
      return {
        status: 200,
        body: {
          video_id: video.id,
          upload_url: `{{mock}}/video-upload/${version}/${video.id}`,
        },
      }
    }
    if (phase !== 'finish') return paramError('upload_phase must be start or finish')
    const video = videos.get(params.get('video_id') ?? '')
    if (video?.pageId !== pageId || video.edge !== edge) return paramError('Invalid video_id')
    if (!video.uploaded) return paramError('The video was not uploaded')
    if (video.finished)
      return error(400, {
        message: '(#100) The video was already published',
        type: 'OAuthException',
        code: 100,
      })
    if (edge === 'video_reels' && params.get('video_state') !== 'PUBLISHED')
      return paramError('video_state must be PUBLISHED')
    if (take(deps.scenarios('duplicate_post'))) return duplicate()
    video.finished = true
    video.description = params.get('description') ?? ''
    // Meta vera gives a reel's post its own id too (0.13.0 test); Feedway keeps the video's
    if (edge === 'video_reels') return published({ success: true, post_id: nextId('7400') })
    return published({ success: true, post_id: newStory(pageId, 'video', video.id).postId })
  }

  async function plainVideo(pageId: string, params: URLSearchParams) {
    const fileUrl = params.get('file_url')
    if (fileUrl === null) return paramError('The parameter file_url is required')
    if (!(await fileDownloads(fileUrl)))
      return error(400, {
        message: '(#389) Unable to fetch video file from URL.',
        type: 'OAuthException',
        code: 389,
      })
    if (take(deps.scenarios('duplicate_post'))) return duplicate()
    const video = newVideo(pageId, 'videos', true)
    video.finished = true
    video.description = params.get('description') ?? ''
    return published({ id: video.id })
  }

  function photoStory(pageId: string, params: URLSearchParams): PublishingAnswer {
    const item = unusedPhoto(pageId, params.get('photo_id') ?? '')
    if (item === null) return paramError('Invalid photo_id')
    if (take(deps.scenarios('duplicate_post'))) return duplicate()
    const story = newStory(pageId, 'photo', item.id)
    item.usedIn = story.postId
    return published({ success: true, post_id: story.postId })
  }

  const processed = (v: Video) => v.uploaded && !v.failed && v.pendingReads === 0
  const videoLink = (v: Video) =>
    v.edge === 'video_reels' ? `/reel/${v.id}` : `/${v.pageId}/videos/${v.id}/`

  /** A read of the status counts down the processing, after it answered. */
  function renderVideo(v: Video, read: boolean): Record<string, unknown> {
    const body = renderVideoNow(v)
    if (read && v.uploaded && v.pendingReads > 0) v.pendingReads -= 1
    return body
  }

  function renderVideoNow(v: Video): Record<string, unknown> {
    return {
      id: v.id,
      description: v.description,
      created_time: metaTime(v.createdAt),
      updated_time: metaTime(v.createdAt),
      status: {
        video_status: v.failed ? 'error' : processed(v) ? 'ready' : 'processing',
        uploading_phase: { status: v.uploaded ? 'complete' : 'not_started' },
        processing_phase: {
          status: !v.uploaded
            ? 'not_started'
            : v.failed
              ? 'error'
              : v.pendingReads > 0
                ? 'in_progress'
                : 'complete',
        },
        // `finish` marks it published at once, before the processing ends (not verified):
        // the check must also wait for `ready`
        publishing_phase: {
          status: v.finished ? 'complete' : 'not_started',
          publish_status: v.finished ? 'published' : 'not_published',
        },
      },
      ...(v.finished && { permalink_url: videoLink(v) }),
    }
  }

  const postLink = (p: Post) =>
    `https://www.facebook.com/${p.pageId}/posts/${p.id.split('_')[1] ?? ''}`

  const renderPost = (p: Post) => ({
    id: p.id,
    message: p.message,
    created_time: metaTime(p.createdAt),
    is_published: true,
    permalink_url: postLink(p),
  })

  // as recorded on Meta vera (0.13.0 test, 21/11): the status in lower case and the time as a
  // string of seconds, not Meta's usual date
  const renderStory = (s: Story) => ({
    post_id: s.postId,
    status: 'published',
    creation_time: String(Math.floor(s.createdAt.getTime() / 1000)),
    media_type: s.mediaType,
    media_id: s.mediaId,
    url: `https://www.facebook.com/stories/${s.pageId}/${s.postId}/`,
  })

  function list<T>(
    items: T[],
    params: URLSearchParams,
    render: (t: T) => unknown,
  ): PublishingAnswer {
    const limit = Math.max(1, Number(params.get('limit') ?? DEFAULT_PAGE) || DEFAULT_PAGE)
    return { status: 200, body: { data: items.reverse().slice(0, limit).map(render) } }
  }

  function remove(id: string, pageId: string): PublishingAnswer {
    const item = photos.get(id)
    if (item?.pageId === pageId && !item.published && item.usedIn === null) {
      photos.delete(id)
      return { status: 200, body: { success: true } }
    }
    const video = videos.get(id)
    if (video?.pageId === pageId && !video.finished) {
      videos.delete(id)
      return { status: 200, body: { success: true } }
    }
    return notFound(id)
  }

  const ownerOf = (id: string) =>
    photos.get(id)?.pageId ??
    videos.get(id)?.pageId ??
    posts.get(id)?.pageId ??
    stories.get(id)?.pageId

  return {
    ownerOf,
    async handle({ method, version, id, edge, params, tokenSubject }) {
      if (deps.isPage(id)) {
        if (method === 'GET' && edge === undefined) {
          const fields = (params.get('fields') ?? '').split(',')
          if (!fields.includes('access_token') || tokenSubject === id) return null
          const missing = deps
            .scenarios('page_token_missing')
            .some((s) => (s.opts.pageId ?? id) === id)
          const token = deps.pageToken(id)
          return {
            status: 200,
            body: { id, ...(!missing && token !== undefined && { access_token: token }) },
          }
        }
        const known = ['photos', 'feed', 'video_reels', 'video_stories', 'videos', 'photo_stories']
        const reads = ['published_posts', 'videos', 'video_reels', 'stories']
        const ours =
          (method === 'POST' && edge !== undefined && known.includes(edge)) ||
          (method === 'GET' && edge !== undefined && reads.includes(edge))
        if (!ours) return null
        if (tokenSubject !== id) return needsPageToken()
        if (method === 'POST') {
          if (edge === 'photos') return photo(id, params)
          if (edge === 'feed') return feed(id, params)
          if (edge === 'video_reels' || edge === 'video_stories')
            return phases(id, edge, version, params)
          if (edge === 'videos') return plainVideo(id, params)
          return photoStory(id, params)
        }
        if (edge === 'published_posts')
          return list(
            [...posts.values()].filter((p) => p.pageId === id),
            params,
            renderPost,
          )
        if (edge === 'stories')
          return list(
            [...stories.values()].filter((s) => s.pageId === id),
            params,
            renderStory,
          )
        const kind = edge === 'videos' ? 'videos' : 'video_reels'
        return list(
          [...videos.values()].filter((v) => v.pageId === id && v.edge === kind && v.finished),
          params,
          (v) => renderVideo(v, false),
        )
      }
      const owner = ownerOf(id)
      if (owner === undefined || edge !== undefined) return null
      if (tokenSubject !== owner) return needsPageToken()
      if (method === 'DELETE') return remove(id, owner)
      if (method !== 'GET') return null
      const video = videos.get(id)
      if (video !== undefined) return { status: 200, body: renderVideo(video, true) }
      const post = posts.get(id)
      if (post !== undefined) return { status: 200, body: renderPost(post) }
      const item = photos.get(id)
      if (item !== undefined) return { status: 200, body: { id, published: item.published } }
      return null
    },
    async upload({ videoId, fileUrl, tokenSubject }) {
      const video = videos.get(videoId)
      if (video === undefined || video.pageId !== tokenSubject || video.edge === 'videos')
        return notFound(videoId)
      if (fileUrl === null) return paramError('The file_url header is required')
      if (!(await fileDownloads(fileUrl)))
        return error(400, {
          message: '(#389) Unable to fetch video file from URL.',
          type: 'OAuthException',
          code: 389,
        })
      video.uploaded = true
      return { status: 200, body: { success: true } }
    },
    reset() {
      photos.clear()
      videos.clear()
      posts.clear()
      stories.clear()
    },
  }
}

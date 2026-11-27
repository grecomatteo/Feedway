import { randomBytes } from 'node:crypto'
import type { ActiveScenario, ScenarioName } from './scenarios.ts'

// The publishing calls of spec §8.5 for Instagram (plan 07, Task 4). Written by hand from the
// content publishing guide and the error codes page of Meta: not verified on the real Graph API.

export interface GraphError {
  message: string
  type: string
  code: number
  error_subcode?: number
}

/** What the server sends: a body, an error, or a body after a delay (a call that times out). */
export type PublishingAnswer =
  { status: number; body: unknown; delayMs?: number } | { status: number; error: GraphError }

type ContainerKind = 'image' | 'video' | 'carousel'
type StatusCode = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED'

interface Container {
  id: string
  igUserId: string
  kind: ContainerKind
  mediaType: 'IMAGE' | 'REELS' | 'STORIES' | 'CAROUSEL' | 'VIDEO'
  carouselItem: boolean
  children: string[]
  caption: string
  /** the usernames invited as collaborators (D-125) */
  collaborators: string[]
  pendingReads: number
  failed: boolean
  /** why it failed, as Meta writes it in `status`: the download (2207052) or the file (2207026) */
  failedWith?: '2207052' | '2207026'
  expired: boolean
  published: boolean
}

export interface PublishedMedia {
  id: string
  igUserId: string
  caption?: string
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'
  media_product_type: 'FEED' | 'REELS' | 'STORY'
  timestamp: string
  permalink: string
  shortcode: string
  /** on Meta's CDN, served here by the mock: an image's (or a carousel's first) picture */
  media_url?: string
  /** a video's cover */
  thumbnail_url?: string
}

export interface Publishing {
  /** The Instagram account a container or a published media belongs to; undefined: not ours. */
  ownerOf(id: string): string | undefined
  /** Posts published on the account through the API, for `content_publishing_limit`. */
  publishedCount(igUserId: string): number
  /** null: not a publishing call, the generic Graph API answers it. */
  handle(call: {
    method: string
    id: string
    edge: string | undefined
    params: URLSearchParams
  }): Promise<PublishingAnswer | null>
  /** A post out gets its picture at another address (`media_url_changed`). */
  movePicture(id: string, url: string): void
  reset(): void
}

interface Deps {
  /** The posts already out when the mock starts (`fixtures/media.json`), for the grid. */
  seed(): PublishedMedia[]
  scenarios<N extends ScenarioName>(name: N): Extract<ActiveScenario, { name: N }>[]
  isInstagramAccount(id: string): boolean
  quotaTotal(igUserId: string): number
  quotaUsedBefore(igUserId: string): number
}

const DEFAULT_IN_PROGRESS_READS = 3
/** Instagram takes up to 3 collaborators when creating a container (D-125). */
const MAX_COLLABORATORS = 3
const DEFAULT_PUBLISH_DELAY_MS = 15_000
const DEFAULT_PAGE = 25
/** The mock's own address, put in by the server as it answers (`{{mock}}`). */
const SELF = '{{mock}}'
const PUBLISHED_PICTURE = `${SELF}/pictures/post-1.jpg?oh=0a0a&oe=6B00`

const paramError = (message: string, subcode?: number): PublishingAnswer => ({
  status: 400,
  error: {
    message,
    type: 'OAuthException',
    code: 100,
    ...(subcode === undefined ? {} : { error_subcode: subcode }),
  },
})

const igError = (code: number, subcode: number, message: string): PublishingAnswer => ({
  status: 400,
  error: { message, type: 'OAuthException', code, error_subcode: subcode },
})

/** Meta's timestamps: `2026-11-20T16:00:00+0000`. */
export const metaTime = (date: Date) => `${date.toISOString().slice(0, 19)}+0000`

/** Takes one use of the first active scenario with uses left; false when there is none. */
export function take(list: { remaining: number }[]): boolean {
  const hit = list.find((s) => s.remaining > 0)
  if (hit === undefined) return false
  hit.remaining -= 1
  return true
}

// Only the machine the mock runs on, as in tests and development (`META_MODE=mock`): the mock
// never fetches an address it is handed on the open network. The address is built again from
// fixed parts, so nothing but the port, the path and the query comes from the request.
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'] as const

/** The address to download, if the mock may reach it; null otherwise. */
export function downloadableUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const protocol = url.protocol === 'http:' ? 'http:' : url.protocol === 'https:' ? 'https:' : null
  const host = LOOPBACK.find((h) => h === url.hostname.toLowerCase())
  if (protocol === null || host === undefined || url.username !== '' || url.password !== '')
    return null
  const port = url.port === '' ? '' : `:${String(Number(url.port))}`
  return `${protocol}//${host}${port}${url.pathname}${url.search}`
}

export async function downloads(raw: string): Promise<boolean> {
  const url = downloadableUrl(raw)
  if (url === null) return false
  try {
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) })
    await res.arrayBuffer()
    return res.ok
  } catch {
    return false
  }
}

export function createPublishing(deps: Deps): Publishing {
  const containers = new Map<string, Container>()
  const media = new Map<string, PublishedMedia>()
  const sow = () => {
    for (const item of deps.seed()) media.set(item.id, item)
  }
  sow()
  const published = new Map<string, number>()
  /** the collaborators invited on a published media, by its id */
  const invited = new Map<string, string[]>()
  let counter = 0

  const nextId = (prefix: string) => `${prefix}${String(++counter).padStart(13, '0')}`

  function statusOf(c: Container): StatusCode {
    if (c.published) return 'PUBLISHED'
    if (!c.expired && take(deps.scenarios('container_expired'))) c.expired = true
    if (c.expired) return 'EXPIRED'
    if (c.failed) return 'ERROR'
    return c.pendingReads > 0 ? 'IN_PROGRESS' : 'FINISHED'
  }

  async function createContainer(igUserId: string, params: URLSearchParams) {
    const type = params.get('media_type')
    const carouselItem = params.get('is_carousel_item') === 'true'
    const imageUrl = params.get('image_url')
    const videoUrl = params.get('video_url')
    let kind: ContainerKind
    let mediaType: Container['mediaType']
    let children: string[] = []
    if (type === 'CAROUSEL') {
      children = (params.get('children') ?? '').split(',').filter((c) => c !== '')
      if (children.length < 2 || children.length > 10)
        return igError(100, 2207028, 'The carousel needs 2 to 10 items.')
      for (const child of children) {
        const c = containers.get(child)
        if (c?.igUserId !== igUserId || !c.carouselItem)
          return paramError(`(#100) Invalid children container: ${child}`)
        if (statusOf(c) !== 'FINISHED')
          return igError(9007, 2207027, 'Media is not ready to be published.')
      }
      kind = 'carousel'
      mediaType = 'CAROUSEL'
    } else if (type === 'REELS' || type === 'STORIES' || type === 'VIDEO' || type === null) {
      if (type === 'REELS' && videoUrl === null)
        return paramError('(#100) The parameter video_url is required')
      if (videoUrl === null && imageUrl === null)
        return paramError('(#100) The parameter image_url is required')
      if (type === 'VIDEO' && !carouselItem)
        return paramError('(#100) VIDEO is only for carousel items: use REELS')
      kind = videoUrl === null ? 'image' : 'video'
      mediaType = type ?? (kind === 'image' ? 'IMAGE' : 'VIDEO')
    } else return igError(100, 2207023, 'The media type is unknown.')
    if (carouselItem && params.has('caption'))
      return paramError('(#100) Carousel items do not take a caption')
    const collaborators = collaboratorsOf(params)
    if (collaborators === null)
      return paramError('(#100) Param collaborators must be an array of usernames')
    if (collaborators.length > 0) {
      if (carouselItem || mediaType === 'STORIES')
        return paramError('(#100) Collaborators are not supported for this media type')
      if (collaborators.length > MAX_COLLABORATORS)
        return paramError('(#100) Param collaborators can have at most 3 usernames')
      const refused = deps
        .scenarios('collaborator_rejected')
        .find(
          (s) =>
            s.remaining > 0 &&
            (s.opts.username === undefined || collaborators.includes(s.opts.username)),
        )
      if (refused !== undefined) {
        refused.remaining -= 1
        return paramError('(#100) Invalid collaborators: a user cannot be invited')
      }
    }

    const failDownload = kind !== 'carousel' && take(deps.scenarios('media_download_failed'))
    let failed = false
    let failedWith: Container['failedWith']
    if (kind !== 'carousel') {
      const ok = !failDownload && (await downloads(videoUrl ?? imageUrl ?? ''))
      // an image is read at once, a video while the container is processed
      if (!ok && kind === 'image')
        return { status: 400, error: { ...mediaFetchError } } satisfies PublishingAnswer
      failed = !ok
      if (failed) failedWith = '2207052'
    }
    if (kind === 'video' && take(deps.scenarios('container_error'))) {
      failed = true
      failedWith = '2207026'
    }
    const slow = deps
      .scenarios('container_in_progress')
      .find((s) => s.remaining > 0 && (kind === 'video' || s.opts.all === true))
    if (slow !== undefined) slow.remaining -= 1

    const container: Container = {
      id: nextId('1789'),
      igUserId,
      kind,
      mediaType,
      carouselItem,
      children,
      caption: params.get('caption') ?? '',
      collaborators,
      pendingReads: slow === undefined ? 0 : (slow.opts.reads ?? DEFAULT_IN_PROGRESS_READS),
      failed,
      ...(failedWith === undefined ? {} : { failedWith }),
      expired: false,
      published: false,
    }
    containers.set(container.id, container)
    return { status: 200, body: { id: container.id } }
  }

  function publish(igUserId: string, params: URLSearchParams): PublishingAnswer {
    const c = containers.get(params.get('creation_id') ?? '')
    if (c?.igUserId !== igUserId || c.carouselItem)
      return igError(24, 2207006, 'The media with the given id was not found.')
    if (c.published) return igError(24, 2207008, 'The media builder does not exist.')
    const status = statusOf(c)
    if (status === 'EXPIRED')
      return igError(-2, 2207020, 'The media you are trying to access has expired.')
    if (status === 'ERROR') return igError(-1, 2207032, 'Create media has failed.')
    if (status === 'IN_PROGRESS')
      return igError(9007, 2207027, 'Media is not ready to be published.')
    const exhausted = deps
      .scenarios('quota_exhausted')
      .some((s) => (s.opts.igUserId ?? igUserId) === igUserId)
    if (
      exhausted ||
      deps.quotaUsedBefore(igUserId) + (published.get(igUserId) ?? 0) >= deps.quotaTotal(igUserId)
    )
      return igError(9, 2207042, 'The account reached the maximum of posts per day.')

    c.published = true
    published.set(igUserId, (published.get(igUserId) ?? 0) + 1)
    const shortcode = randomBytes(8).toString('base64url')
    const product = c.mediaType === 'REELS' ? 'REELS' : c.mediaType === 'STORIES' ? 'STORY' : 'FEED'
    const item: PublishedMedia = {
      id: nextId('1800'),
      igUserId,
      ...(product === 'STORY' ? {} : { caption: c.caption }),
      media_type: c.kind === 'carousel' ? 'CAROUSEL_ALBUM' : c.kind === 'video' ? 'VIDEO' : 'IMAGE',
      media_product_type: product,
      timestamp: metaTime(new Date()),
      permalink:
        product === 'STORY'
          ? `https://instagram.com/stories/mock/${shortcode}`
          : `https://www.instagram.com/${product === 'REELS' ? 'reel' : 'p'}/${shortcode}/`,
      shortcode,
      // the picture on the CDN: one of the mock's, whatever was published
      ...(c.kind === 'video'
        ? { media_url: `${SELF}/videos/${shortcode}.mp4`, thumbnail_url: PUBLISHED_PICTURE }
        : { media_url: PUBLISHED_PICTURE }),
    }
    media.set(item.id, item)
    if (c.collaborators.length > 0) invited.set(item.id, [...c.collaborators])
    const late = deps.scenarios('publish_timeout_but_created').find((s) => s.remaining > 0)
    if (late !== undefined) {
      late.remaining -= 1
      return {
        status: 200,
        body: { id: item.id },
        delayMs: late.opts.delayMs ?? DEFAULT_PUBLISH_DELAY_MS,
      }
    }
    return { status: 200, body: { id: item.id } }
  }

  function list(igUserId: string, stories: boolean, params: URLSearchParams): PublishingAnswer {
    // newest first; the same second keeps the order they came out in
    const items = [...media.values()]
      .filter((m) => m.igUserId === igUserId && (m.media_product_type === 'STORY') === stories)
      .reverse()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    const limit = Math.max(1, Number(params.get('limit') ?? DEFAULT_PAGE) || DEFAULT_PAGE)
    return { status: 200, body: { data: items.slice(0, limit).map(render) } }
  }

  /** `GET /{ig-media-id}/collaborators`: the invited, `Pending` until a scenario answers. */
  function collaboratorsAnswer(id: string): PublishingAnswer {
    const answers = deps.scenarios('collaborator_answered')
    const data = (invited.get(id) ?? []).map((username, i) => {
      const answer = answers.find(
        (a) => a.opts.username === undefined || a.opts.username === username,
      )
      return {
        id: `1784${String(i + 1).padStart(12, '0')}`,
        username,
        invite_status: answer?.opts.status ?? 'Pending',
      }
    })
    return { status: 200, body: { data } }
  }

  const render = (m: PublishedMedia): Record<string, unknown> =>
    Object.fromEntries(Object.entries(m).filter(([key]) => key !== 'igUserId'))

  return {
    ownerOf: (id) => containers.get(id)?.igUserId ?? media.get(id)?.igUserId,
    publishedCount: (igUserId) => published.get(igUserId) ?? 0,
    async handle({ method, id, edge, params }) {
      if (deps.isInstagramAccount(id)) {
        if (method === 'POST' && edge === 'media') return createContainer(id, params)
        if (method === 'POST' && edge === 'media_publish') return publish(id, params)
        if (method === 'GET' && edge === 'media') return list(id, false, params)
        if (method === 'GET' && edge === 'stories') return list(id, true, params)
        return null
      }
      if (method === 'GET' && edge === 'collaborators' && media.has(id))
        return collaboratorsAnswer(id)
      if (method !== 'GET' || edge !== undefined) return null
      const container = containers.get(id)
      if (container !== undefined) {
        const status = statusOf(container)
        if (status === 'IN_PROGRESS') container.pendingReads -= 1
        return {
          status: 200,
          body: {
            id,
            status_code: status,
            // the texts real Meta wrote beside the code (0.13.0 test)
            ...(status === 'FINISHED' && {
              status: 'Finished: Media has been uploaded and it is ready to be published.',
            }),
            ...(status === 'IN_PROGRESS' && {
              status: 'In Progress: Media is still being processed.',
            }),
            ...(status === 'ERROR' && { status: `Error: ${container.failedWith ?? '2207026'}` }),
          },
        }
      }
      const item = media.get(id)
      return item === undefined ? null : { status: 200, body: render(item) }
    },
    movePicture(id, url) {
      const item = media.get(id)
      if (item === undefined) return
      if (item.thumbnail_url !== undefined) item.thumbnail_url = url
      else item.media_url = url
    },
    reset() {
      containers.clear()
      media.clear()
      published.clear()
      invited.clear()
      sow()
    },
  }
}

/**
 * The `collaborators` of a container: a JSON array of usernames, as Meta's reference writes
 * it (not verified); [] when left out, null when it is no such array.
 */
function collaboratorsOf(params: URLSearchParams): string[] | null {
  const raw = params.get('collaborators')
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every((n) => typeof n === 'string') ? parsed : null
  } catch {
    return null
  }
}

const mediaFetchError: GraphError = {
  message: "Media download has failed. The media URI doesn't meet our requirements.",
  type: 'OAuthException',
  code: 9004,
  error_subcode: 2207052,
}

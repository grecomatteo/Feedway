import { createHmac, randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Clock, Logger } from '@app/application'
import type { MetaBusinessUsage, MetaUsage } from '@app/domain/platforms/meta'
import { z } from 'zod'
import { classifyMetaError, MetaError } from './errors.js'
import { createRecordingRedactor } from './recording.js'

// The only place that builds Meta addresses (ADR 019, spec §8.6). Facts: docs/platforms/meta.md.

export type MetaMode = 'live' | 'mock' | 'dry-run'

export interface MetaAppCredentials {
  appId: string
  appSecret: string
}

/** A user, system user or page token, with the app secret for `appsecret_proof`. */
export interface MetaTokenCredentials {
  accessToken: string
  appSecret: string
}

export interface MetaResult<T> {
  data: T
  usage: MetaUsage
}

export interface MetaPage<T> {
  items: T[]
  /** Cursor for the next page, null on the last one. */
  nextCursor: string | null
}

export interface MetaInstagramAccount {
  id: string
  username: string | null
  name: string | null
  profilePictureUrl: string | null
}

export interface MetaFacebookPage {
  id: string
  name: string | null
  pictureUrl: string | null
  /** Page token: only `me/accounts` gives it, and not without a role on the page. */
  accessToken: string | null
  tasks: string[]
  instagramAccount: MetaInstagramAccount | null
}

export interface MetaTokenInfo {
  isValid: boolean
  type: string | null
  appId: string | null
  userId: string | null
  /** `never` and `unknown` both come from `expires_at = 0`: see `expiry()`. */
  expiresAt: Date | 'never' | 'unknown'
  dataAccessExpiresAt: Date | 'never' | 'unknown'
  issuedAt: Date | null
  scopes: string[]
  granularScopes: { scope: string; targetIds: string[] }[]
  error: { code: number; subcode: number | null } | null
}

export interface MetaPublishingLimit {
  quotaUsage: number
  quotaTotal: number
  quotaDurationSeconds: number
}

/** An Instagram container's state (§8.7: read at most once a minute). */
export interface MetaContainerStatus {
  statusCode: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED' | 'UNKNOWN'
  /** With `ERROR`, Meta's subcode as text; never shown, kept only as a code. */
  status: string | null
}

/** A published Instagram media, with the fields of §9.5 and §9.6. */
export interface MetaInstagramMedia {
  id: string
  caption: string | null
  timestamp: Date | null
  mediaType: string | null
  mediaProductType: string | null
  permalink: string | null
}

/** A Facebook video or reel's processing (§9.6), from `GET /{video}?fields=status`. */
export interface MetaFacebookVideo {
  id: string
  /** `ready`, `processing`, `expired`, `error`; null when Meta left it out. */
  videoStatus: string | null
  uploadingStatus: string | null
  processingStatus: string | null
  publishingStatus: string | null
  /** `published` or `not_published`. */
  publishStatus: string | null
  /** Often a path (`/reel/…`), not a whole address. */
  permalink: string | null
}

/** A published Page post, video or reel, for the uncertain search (§9.5) and the check (§9.6). */
export interface MetaFacebookPost {
  id: string
  message: string | null
  createdAt: Date | null
  isPublished: boolean | null
  permalink: string | null
}

export interface MetaFacebookStory {
  postId: string
  status: string | null
  createdAt: Date | null
  /** `photo` or `video`. */
  mediaType: string | null
  permalink: string | null
}

export interface MetaGraphClient {
  loginDialogUrl(input: {
    appId: string
    configId: string
    redirectUri: string
    state: string
  }): string
  exchangeCode(
    app: MetaAppCredentials,
    input: { code: string; redirectUri: string },
  ): Promise<MetaResult<{ accessToken: string }>>
  debugToken(app: MetaAppCredentials, inputToken: string): Promise<MetaResult<MetaTokenInfo>>
  getMe(
    credentials: MetaTokenCredentials,
  ): Promise<MetaResult<{ id: string; name: string | null; clientBusinessId: string | null }>>
  /** `me/businesses`: the Business Manager the system user belongs to (plan 07, Task 5, B11). */
  listUserBusinesses(
    credentials: MetaTokenCredentials,
  ): Promise<MetaResult<{ id: string; name: string | null }[]>>
  /** `GET /{business-id}?fields=name`: the Business the Owner named in the integration (B11). */
  getBusiness(
    credentials: MetaTokenCredentials,
    businessId: string,
  ): Promise<MetaResult<{ id: string; name: string | null }>>
  listUserPages(
    credentials: MetaTokenCredentials,
    page?: { after?: string; limit?: number },
  ): Promise<MetaResult<MetaPage<MetaFacebookPage>>>
  /** Every Instagram account assigned to the system user, with or without a page. */
  listAssignedInstagramAccounts(
    credentials: MetaTokenCredentials,
    page?: { after?: string; limit?: number },
  ): Promise<MetaResult<MetaPage<MetaInstagramAccount>>>
  /**
   * Not used by the system user (verified on 2026-11-11): `owned_pages` and `client_pages` list
   * pages not assigned to it, and the business's Instagram edges answer 100/33.
   */
  listBusinessPages(
    credentials: MetaTokenCredentials,
    input: { businessId: string; relation: 'owned' | 'client'; after?: string; limit?: number },
  ): Promise<MetaResult<MetaPage<MetaFacebookPage>>>
  listBusinessInstagramAccounts(
    credentials: MetaTokenCredentials,
    input: { businessId: string; after?: string; limit?: number },
  ): Promise<MetaResult<MetaPage<MetaInstagramAccount>>>
  getInstagramAccount(
    credentials: MetaTokenCredentials,
    igUserId: string,
  ): Promise<MetaResult<MetaInstagramAccount>>
  getPublishingLimit(
    credentials: MetaTokenCredentials,
    igUserId: string,
    signal?: AbortSignal,
  ): Promise<MetaResult<MetaPublishingLimit>>
  /** `POST /{ig}/media`: a container, not yet published. */
  createInstagramContainer(
    credentials: MetaTokenCredentials,
    igUserId: string,
    params: Record<string, string>,
    signal: AbortSignal,
  ): Promise<MetaResult<{ id: string }>>
  getContainerStatus(
    credentials: MetaTokenCredentials,
    containerId: string,
    signal: AbortSignal,
  ): Promise<MetaResult<MetaContainerStatus>>
  /** `POST /{ig}/media_publish`: never repeated by the client, a timeout is uncertain. */
  publishInstagramContainer(
    credentials: MetaTokenCredentials,
    igUserId: string,
    containerId: string,
    signal: AbortSignal,
  ): Promise<MetaResult<{ id: string }>>
  /** The latest media of the account (`media`) or its stories (`stories`), newest first. */
  listInstagramMedia(
    credentials: MetaTokenCredentials,
    igUserId: string,
    input: { edge: 'media' | 'stories'; limit: number },
    signal: AbortSignal,
  ): Promise<MetaResult<MetaInstagramMedia[]>>
  getInstagramMedia(
    credentials: MetaTokenCredentials,
    mediaId: string,
    signal: AbortSignal,
  ): Promise<MetaResult<MetaInstagramMedia>>
  /** `GET /{page}?fields=access_token`: the Page token, never kept (plan 07, Task 5). */
  getPageAccessToken(
    credentials: MetaTokenCredentials,
    pageId: string,
    signal: AbortSignal,
  ): Promise<MetaResult<{ accessToken: string | null }>>
  /**
   * `POST /{page}/photos`. With `published=false` the photo waits for a post (and the call
   * may be repeated); otherwise it is the call that publishes, never repeated.
   */
  createPagePhoto(
    credentials: MetaTokenCredentials,
    pageId: string,
    params: Record<string, string>,
    signal: AbortSignal,
  ): Promise<MetaResult<{ id: string; postId: string | null }>>
  /** `POST /{page}/feed`: publishes, never repeated. */
  createPageFeedPost(
    credentials: MetaTokenCredentials,
    pageId: string,
    params: Record<string, string>,
    signal: AbortSignal,
  ): Promise<MetaResult<{ id: string }>>
  /** `POST /{page}/video_reels|video_stories` with `upload_phase=start`. */
  startPageVideoUpload(
    credentials: MetaTokenCredentials,
    pageId: string,
    edge: 'video_reels' | 'video_stories',
    signal: AbortSignal,
  ): Promise<MetaResult<{ videoId: string }>>
  /** The hosted upload on `rupload.facebook.com`: Meta downloads `fileUrl`. */
  uploadHostedVideo(
    credentials: MetaTokenCredentials,
    videoId: string,
    fileUrl: string,
    signal: AbortSignal,
  ): Promise<MetaResult<{ success: boolean }>>
  /**
   * The cover of a Page video or reel (`POST /{video-id}/thumbnails`, D-120.9): the image goes
   * as the `source` file, `is_preferred=true` makes it the one shown. Needs
   * `pages_manage_engagement` and `pages_read_user_content`; not verified on real Meta.
   */
  uploadVideoThumbnail(
    credentials: MetaTokenCredentials,
    videoId: string,
    image: { bytes: Uint8Array; contentType: string },
    signal: AbortSignal,
  ): Promise<MetaResult<{ success: boolean }>>
  /** `upload_phase=finish`: publishes, never repeated. */
  finishPageVideoUpload(
    credentials: MetaTokenCredentials,
    pageId: string,
    edge: 'video_reels' | 'video_stories',
    params: Record<string, string>,
    signal: AbortSignal,
  ): Promise<MetaResult<{ success: boolean; postId: string | null }>>
  /** `POST /{page}/videos` with `file_url`: publishes, never repeated. */
  createPageVideo(
    credentials: MetaTokenCredentials,
    pageId: string,
    params: Record<string, string>,
    signal: AbortSignal,
  ): Promise<MetaResult<{ id: string }>>
  /** `POST /{page}/photo_stories` from an unpublished photo: publishes, never repeated. */
  createPagePhotoStory(
    credentials: MetaTokenCredentials,
    pageId: string,
    photoId: string,
    signal: AbortSignal,
  ): Promise<MetaResult<{ success: boolean; postId: string | null }>>
  getFacebookVideo(
    credentials: MetaTokenCredentials,
    videoId: string,
    signal: AbortSignal,
  ): Promise<MetaResult<MetaFacebookVideo>>
  getFacebookPost(
    credentials: MetaTokenCredentials,
    postId: string,
    signal: AbortSignal,
  ): Promise<MetaResult<MetaFacebookPost>>
  /** The latest posts (`published_posts`), videos or reels of the Page, newest first. */
  listPagePublished(
    credentials: MetaTokenCredentials,
    pageId: string,
    input: { edge: 'published_posts' | 'videos' | 'video_reels'; limit: number },
    signal: AbortSignal,
  ): Promise<MetaResult<MetaFacebookPost[]>>
  listPageStories(
    credentials: MetaTokenCredentials,
    pageId: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<MetaResult<MetaFacebookStory[]>>
  /** `DELETE /{object}`: an unpublished photo or video thrown away (plan 07, P2). */
  deleteObject(
    credentials: MetaTokenCredentials,
    objectId: string,
    signal: AbortSignal,
  ): Promise<MetaResult<{ success: boolean }>>
}

export interface MetaGraphClientOptions {
  mode: MetaMode
  version: string
  /**
   * Required in `mock` (the fake Graph API serves the API, the login dialog and the video
   * uploads of `rupload.facebook.com`).
   */
  baseUrl?: string
  clock: Clock
  logger: Logger
  timeoutMs?: number
  /**
   * The calls where Meta fetches the file before it answers (a Page's photos and videos, the
   * hosted upload of a reel): a large file needs longer than the other calls (review R14).
   * 120 s by default, well below the step's 300 s.
   */
  fileTimeoutMs?: number
  /** First wait between attempts; grows and is randomized. */
  retryBaseDelayMs?: number
  /** META_RECORD_DIR: redacted answers for Task 13. Used only in `live`. */
  recordDir?: string | null
}

const GRAPH_HOST = 'https://graph.facebook.com'
const DIALOG_HOST = 'https://www.facebook.com'
const UPLOAD_HOST = 'https://rupload.facebook.com'
const MAX_ATTEMPTS = 3
const DEFAULT_LIMIT = 50

// Tokens that Meta documents as never expiring (docs/platforms/meta.md §Salute). Not verified:
// the real `type` of each token is checked at the end of Task 7.
const NEVER_EXPIRING_TYPES = new Set(['SYSTEM_USER'])

const igAccountFields = 'id,username,name,profile_picture_url'
// without a size Meta gives a picture of about 50 px, blurred everywhere in the panel
const pageFields = `id,name,picture.width(256).height(256){url},instagram_business_account{${igAccountFields}}`

const igAccountSchema = z.object({
  id: z.string(),
  username: z.string().optional(),
  name: z.string().optional(),
  profile_picture_url: z.string().optional(),
})

const pageSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  picture: z.object({ data: z.object({ url: z.string().optional() }) }).optional(),
  access_token: z.string().optional(),
  tasks: z.array(z.string()).optional(),
  permitted_tasks: z.array(z.string()).optional(),
  instagram_business_account: igAccountSchema.optional(),
})

const listSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    data: z.array(item),
    paging: z
      .object({
        cursors: z.object({ after: z.string().optional() }).optional(),
        next: z.string().optional(),
      })
      .optional(),
  })

const debugSchema = z.object({
  data: z.object({
    is_valid: z.boolean(),
    type: z.string().optional(),
    app_id: z.string().optional(),
    user_id: z.string().optional(),
    expires_at: z.number().optional(),
    data_access_expires_at: z.number().optional(),
    issued_at: z.number().optional(),
    scopes: z.array(z.string()).optional(),
    granular_scopes: z
      .array(z.object({ scope: z.string(), target_ids: z.array(z.string()).optional() }))
      .optional(),
    error: z.object({ code: z.number(), subcode: z.number().optional() }).optional(),
  }),
})

const igMediaFields = 'id,caption,timestamp,media_type,media_product_type,permalink'

/** Meta's ids are digits (or `dry-run`'s fake ones): never a dot, a slash or a comma. */
const objectId = z.string().regex(/^([0-9]{1,32}|dry-run-[0-9a-f]{16})$/)

const igMediaSchema = z.object({
  id: objectId,
  caption: z.string().optional(),
  timestamp: z.string().optional(),
  media_type: z.string().optional(),
  media_product_type: z.string().optional(),
  permalink: z.string().optional(),
})

/** A Page post id is `{page}_{post}`; a story's may come as a number. */
const postId = z
  .union([z.string(), z.number().int().nonnegative()])
  .transform(String)
  .pipe(z.string().regex(/^([0-9]{1,32}(_[0-9]{1,32})?|dry-run-[0-9a-f]{16})$/))

const fbPostFields = 'id,message,created_time,is_published,permalink_url'
const fbVideoListFields = 'id,description,created_time,updated_time,permalink_url'

const fbPostSchema = z.object({
  id: postId,
  message: z.string().optional(),
  description: z.string().optional(),
  created_time: z.string().optional(),
  updated_time: z.string().optional(),
  is_published: z.boolean().optional(),
  permalink_url: z.string().optional(),
})

const toFbPost = (p: z.infer<typeof fbPostSchema>): MetaFacebookPost => ({
  id: p.id,
  message: p.message ?? p.description ?? null,
  createdAt: metaDate(p.created_time ?? p.updated_time),
  isPublished: p.is_published ?? null,
  permalink: p.permalink_url ?? null,
})

const phaseSchema = z.object({ status: z.string().optional() }).optional()

const fbVideoSchema = z.object({
  id: objectId,
  status: z
    .object({
      video_status: z.string().optional(),
      uploading_phase: phaseSchema,
      processing_phase: phaseSchema,
      publishing_phase: z
        .object({ status: z.string().optional(), publish_status: z.string().optional() })
        .optional(),
    })
    .optional(),
  permalink_url: z.string().optional(),
})

const fbStorySchema = z.object({
  post_id: postId,
  status: z.string().optional(),
  creation_time: z.union([z.string(), z.number()]).optional(),
  media_type: z.string().optional(),
  url: z.string().optional(),
})

/**
 * A story's `creation_time`: real Meta sends Unix seconds as a string of digits («1795276588»,
 * 0.13.0 test), which read as a date made the uncertain search never find the story. A number or
 * Meta's date text are still read, as the reference shows neither.
 */
function storyDate(value: string | number | undefined): Date | null {
  if (typeof value === 'string' && /^\d+$/.test(value)) return storyDate(Number(value))
  if (typeof value !== 'number') return metaDate(value)
  const date = new Date(value * 1000)
  return Number.isNaN(date.getTime()) ? null : date
}

const CONTAINER_STATUSES = ['EXPIRED', 'ERROR', 'FINISHED', 'IN_PROGRESS', 'PUBLISHED'] as const

/** Meta writes `2026-11-20T16:00:00+0000`, which `Date` reads only with a colon in the offset. */
function metaDate(value: string | undefined): Date | null {
  if (value === undefined) return null
  const date = new Date(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isNaN(date.getTime()) ? null : date
}

const toIgMedia = (m: z.infer<typeof igMediaSchema>): MetaInstagramMedia => ({
  id: m.id,
  caption: m.caption ?? null,
  timestamp: metaDate(m.timestamp),
  mediaType: m.media_type ?? null,
  mediaProductType: m.media_product_type ?? null,
  permalink: m.permalink ?? null,
})

const errorSchema = z.object({
  error: z.object({
    code: z.number().int(),
    error_subcode: z.number().int().optional(),
    fbtrace_id: z.string().optional(),
  }),
})

const countersSchema = z.object({
  call_count: z.number(),
  total_cputime: z.number(),
  total_time: z.number(),
})

const businessUsageSchema = z.record(
  z.string(),
  z.array(
    countersSchema.extend({
      type: z.string(),
      estimated_time_to_regain_access: z.number().optional(),
    }),
  ),
)

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function readUsage(headers: Headers): MetaUsage {
  const app = countersSchema.safeParse(parseJson(headers.get('x-app-usage') ?? ''))
  const business = businessUsageSchema.safeParse(
    parseJson(headers.get('x-business-use-case-usage') ?? ''),
  )
  const entries: MetaBusinessUsage[] = business.success
    ? Object.entries(business.data).flatMap(([businessId, list]) =>
        list.map((u) => ({
          businessId,
          type: u.type,
          callCount: u.call_count,
          totalCputime: u.total_cputime,
          totalTime: u.total_time,
          estimatedTimeToRegainAccessMinutes: u.estimated_time_to_regain_access ?? 0,
        })),
      )
    : []
  return {
    app: app.success
      ? {
          callCount: app.data.call_count,
          totalCputime: app.data.total_cputime,
          totalTime: app.data.total_time,
        }
      : null,
    business: entries,
  }
}

function retryAfterOf(headers: Headers): number | null {
  const value = Number(headers.get('retry-after'))
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * `expires_at = 0` is not documented: it means "never" only for the token types Meta says do
 * not expire. Not verified, checked at the end of Task 7 (docs/platforms/meta.md).
 */
function expiry(seconds: number | undefined, type: string | undefined): Date | 'never' | 'unknown' {
  if (seconds === undefined) return 'unknown'
  if (seconds === 0)
    return type !== undefined && NEVER_EXPIRING_TYPES.has(type) ? 'never' : 'unknown'
  return new Date(seconds * 1000)
}

const toIgAccount = (a: z.infer<typeof igAccountSchema>): MetaInstagramAccount => ({
  id: a.id,
  username: a.username ?? null,
  name: a.name ?? null,
  profilePictureUrl: a.profile_picture_url ?? null,
})

const toPage = (p: z.infer<typeof pageSchema>): MetaFacebookPage => ({
  id: p.id,
  name: p.name ?? null,
  pictureUrl: p.picture?.data.url ?? null,
  accessToken: p.access_token ?? null,
  tasks: p.tasks ?? p.permitted_tasks ?? [],
  instagramAccount: p.instagram_business_account ? toIgAccount(p.instagram_business_account) : null,
})

const toMetaPage = <T, U>(
  list: {
    data: T[]
    paging?:
      | { cursors?: { after?: string | undefined } | undefined; next?: string | undefined }
      | undefined
  },
  map: (t: T) => U,
): MetaPage<U> => ({
  items: list.data.map(map),
  // Meta gives `next` only when there is another page; the cursor alone is also on the last one
  nextCursor: list.paging?.next !== undefined ? (list.paging.cursors?.after ?? null) : null,
})

interface CallSpec {
  /** Stable label for the logs and the recordings, never the address. */
  name: string
  path: string
  params?: Record<string, string>
  /** Token in the Authorization header, with `appsecret_proof`. */
  credentials?: MetaTokenCredentials
  /** App token (`id|secret`) in the header: `debug_token`, which takes no proof. */
  appToken?: string
  /** False for calls that must not run twice: the authorization code works only once. */
  retry?: boolean
  /** GET by default; a POST sends `params` as a form body. */
  method?: 'GET' | 'POST' | 'DELETE'
  /** The job's signal: aborting it stops the call (and the waits between attempts). */
  signal?: AbortSignal | undefined
  /**
   * `upload`: `rupload.facebook.com`, with the token as `Authorization: OAuth` (Reels
   * publishing guide) and `headers` (`file_url`).
   */
  host?: 'graph' | 'upload'
  headers?: Record<string, string>
  /** A POST with a file: `params` and the file go as `multipart/form-data`. */
  file?: { field: string; name: string; bytes: Uint8Array; contentType: string }
  /**
   * Meta fetches a file before it answers, or is known to be slow to answer (Instagram's
   * publish): the longer timeout (`fileTimeoutMs`).
   */
  fetchesFile?: boolean
}

export function createMetaGraphClient(opts: MetaGraphClientOptions): MetaGraphClient {
  if (opts.mode === 'mock' && opts.baseUrl === undefined)
    throw new Error('META_MODE=mock needs the address of the fake Graph API')
  const graphBase = `${opts.baseUrl ?? GRAPH_HOST}/${opts.version}`
  const dialogBase = `${opts.baseUrl ?? DIALOG_HOST}/${opts.version}`
  const uploadBase = `${opts.baseUrl ?? UPLOAD_HOST}/video-upload/${opts.version}`
  const timeoutMs = opts.timeoutMs ?? 10_000
  const fileTimeoutMs = opts.fileTimeoutMs ?? 120_000
  const baseDelay = opts.retryBaseDelayMs ?? 500
  const recordDir = opts.mode === 'live' ? (opts.recordDir ?? null) : null
  const redact = createRecordingRedactor()
  // web and worker share the folder and each counts from 1: the prefix keeps their files apart,
  // and starts with the time so a listing sorts the sessions in order
  const startedAt = opts.clock
    .now()
    .toISOString()
    .replaceAll(/[-:]|\.\d+/g, '')
  const session = `${startedAt}-${randomBytes(3).toString('hex')}`
  let recorded = 0

  async function record(name: string, status: number, body: unknown): Promise<void> {
    if (recordDir === null) return
    recorded += 1
    try {
      await mkdir(recordDir, { recursive: true })
      const file = join(
        recordDir,
        `${session}-${String(recorded).padStart(4, '0')}-${name.replaceAll('/', '_')}.json`,
      )
      await writeFile(file, JSON.stringify({ call: name, status, body: redact(body) }, null, 2), {
        flag: 'wx',
      })
    } catch (err) {
      opts.logger.warn({ metaCall: name, err }, 'meta recording failed')
    }
  }

  /**
   * `dry-run` (plan 03): reads go to Meta, writes never leave and give a fake id; a read of a
   * fake id is answered here (a finished container, a media without fields).
   */
  function dryRun<T>(spec: CallSpec, schema: z.ZodType<T>): MetaResult<T> | null {
    if (opts.mode !== 'dry-run') return null
    const method = spec.method ?? 'GET'
    const fakeRead = method === 'GET' && spec.path.includes('/dry-run-')
    if (method === 'GET' && !fakeRead) return null
    const body = fakeRead
      ? { id: spec.path.split('/').pop() ?? '', status_code: 'FINISHED' }
      : (() => {
          const id = `dry-run-${randomBytes(8).toString('hex')}`
          // every write's answer: an id, Facebook's video sessions and stories, a success
          return { id, video_id: id, post_id: id, success: true }
        })()
    opts.logger.info({ metaCall: spec.name, method }, 'meta call skipped (dry-run)')
    const parsed = schema.safeParse(body)
    if (!parsed.success) throw new MetaError({ kind: 'uncertain', reason: 'invalid_response' })
    return { data: parsed.data, usage: { app: null, business: [] } }
  }

  async function attempt<T>(spec: CallSpec, schema: z.ZodType<T>): Promise<MetaResult<T>> {
    const skipped = dryRun(spec, schema)
    if (skipped !== null) return skipped
    const url = new URL(`${spec.host === 'upload' ? uploadBase : graphBase}${spec.path}`)
    const method = spec.method ?? 'GET'
    const form = spec.file === undefined ? new URLSearchParams() : new FormData()
    for (const [k, v] of Object.entries(spec.params ?? {}))
      if (method === 'POST') form.set(k, v)
      else url.searchParams.set(k, v)
    if (spec.file !== undefined && form instanceof FormData)
      form.set(
        spec.file.field,
        // a copy on its own ArrayBuffer, as Blob takes it
        new Blob([new Uint8Array(spec.file.bytes)], { type: spec.file.contentType }),
        spec.file.name,
      )
    const headers: Record<string, string> = { accept: 'application/json', ...spec.headers }
    if (spec.credentials !== undefined) {
      headers.authorization = `${spec.host === 'upload' ? 'OAuth' : 'Bearer'} ${spec.credentials.accessToken}`
      url.searchParams.set(
        'appsecret_proof',
        createHmac('sha256', spec.credentials.appSecret)
          .update(spec.credentials.accessToken)
          .digest('hex'),
      )
    } else if (spec.appToken !== undefined) headers.authorization = `Bearer ${spec.appToken}`

    let res: Response
    let text: string
    const started = opts.clock.now().getTime()
    try {
      const timeout = AbortSignal.timeout(spec.fetchesFile === true ? fileTimeoutMs : timeoutMs)
      res = await fetch(url, {
        method,
        headers,
        ...(method === 'POST' && spec.host !== 'upload' && { body: form }),
        signal: spec.signal === undefined ? timeout : AbortSignal.any([timeout, spec.signal]),
      })
      text = await res.text()
    } catch (err) {
      // stopped from outside (the worker shuts down): like a timeout, the request may have acted
      if (spec.signal?.aborted === true)
        throw new MetaError({
          kind: spec.retry === false ? 'uncertain' : 'transient',
          reason: 'aborted',
        })
      // Meta may have acted on a request that timed out: never retried (plan 03, Task 3)
      if (err instanceof DOMException && err.name === 'TimeoutError')
        throw new MetaError({ kind: 'uncertain', reason: 'timeout' })
      // without retries the request may have reached Meta: the outcome is unknown
      throw new MetaError({
        kind: spec.retry === false ? 'uncertain' : 'transient',
        reason: 'meta_unavailable',
      })
    }
    const body = parseJson(text)
    const usage = readUsage(res.headers)
    const retryAfterSeconds = retryAfterOf(res.headers)
    await record(spec.name, res.status, body ?? null)

    const metaError = errorSchema.safeParse(body)
    if (metaError.success) {
      const { code, error_subcode: subcode, fbtrace_id: fbtraceId } = metaError.data.error
      throw new MetaError({
        ...classifyMetaError(code, subcode ?? null),
        status: res.status,
        metaCode: code,
        subcode: subcode ?? null,
        fbtraceId: fbtraceId ?? null,
        retryAfterSeconds,
        usage,
      })
    }
    if (body === undefined || !res.ok) {
      const unavailable = res.status === 429 || res.status >= 500
      throw new MetaError({
        kind: unavailable ? 'transient' : 'uncertain',
        reason: unavailable ? 'meta_unavailable' : 'invalid_response',
        status: res.status,
        retryAfterSeconds,
        usage,
      })
    }
    const parsed = schema.safeParse(body)
    if (!parsed.success)
      throw new MetaError({
        kind: 'uncertain',
        reason: 'invalid_response',
        status: res.status,
        usage,
      })
    opts.logger.debug(
      { metaCall: spec.name, status: res.status, durationMs: opts.clock.now().getTime() - started },
      'meta call',
    )
    return { data: parsed.data, usage }
  }

  async function call<T>(spec: CallSpec, schema: z.ZodType<T>): Promise<MetaResult<T>> {
    for (let n = 1; ; n++) {
      try {
        return await attempt(spec, schema)
      } catch (err) {
        if (!(err instanceof MetaError)) throw err
        opts.logger.warn(
          {
            metaCall: spec.name,
            attempt: n,
            kind: err.kind,
            reason: err.reason,
            status: err.status,
            metaCode: err.metaCode,
            subcode: err.subcode,
            fbtraceId: err.fbtraceId,
          },
          'meta call failed',
        )
        // Rate limits and blocks are transient too, but waiting seconds does not help: the
        // caller waits with Retry-After or the usage headers (spec §8.6, from stage 7)
        if (
          err.reason !== 'meta_unavailable' ||
          spec.retry === false ||
          n >= MAX_ATTEMPTS ||
          spec.signal?.aborted === true
        )
          throw err
        const wait = baseDelay * 2 ** (n - 1) * (0.5 + Math.random())
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, wait)
          spec.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              resolve()
            },
            { once: true },
          )
        })
      }
    }
  }

  const paging = (p: { after?: string; limit?: number } | undefined): Record<string, string> => ({
    limit: String(p?.limit ?? DEFAULT_LIMIT),
    ...(p?.after === undefined ? {} : { after: p.after }),
  })

  return {
    loginDialogUrl({ appId, configId, redirectUri, state }) {
      const url = new URL(`${dialogBase}/dialog/oauth`)
      // with config_id there is no `scope` ("config_id has replaced scope")
      url.search = new URLSearchParams({
        client_id: appId,
        config_id: configId,
        redirect_uri: redirectUri,
        state,
        response_type: 'code',
        override_default_response_type: 'true',
      }).toString()
      return url.toString()
    },

    async exchangeCode(app, { code, redirectUri }) {
      // Meta wants these in the address: it is never logged (only `name` is)
      const result = await call(
        {
          name: 'oauth/access_token',
          retry: false,
          path: '/oauth/access_token',
          params: {
            client_id: app.appId,
            client_secret: app.appSecret,
            code,
            redirect_uri: redirectUri,
          },
        },
        z.object({ access_token: z.string() }),
      )
      return { data: { accessToken: result.data.access_token }, usage: result.usage }
    },

    async debugToken(app, inputToken) {
      const result = await call(
        {
          name: 'debug_token',
          path: '/debug_token',
          params: { input_token: inputToken },
          appToken: `${app.appId}|${app.appSecret}`,
        },
        debugSchema,
      )
      const d = result.data.data
      return {
        data: {
          isValid: d.is_valid,
          type: d.type ?? null,
          appId: d.app_id ?? null,
          userId: d.user_id ?? null,
          expiresAt: expiry(d.expires_at, d.type),
          dataAccessExpiresAt: expiry(d.data_access_expires_at, d.type),
          issuedAt: d.issued_at === undefined ? null : new Date(d.issued_at * 1000),
          scopes: d.scopes ?? [],
          granularScopes: (d.granular_scopes ?? []).map((g) => ({
            scope: g.scope,
            targetIds: g.target_ids ?? [],
          })),
          error: d.error ? { code: d.error.code, subcode: d.error.subcode ?? null } : null,
        },
        usage: result.usage,
      }
    },

    async getMe(credentials) {
      const result = await call(
        { name: 'me', path: '/me', params: { fields: 'id,name,client_business_id' }, credentials },
        z.object({
          id: z.string(),
          name: z.string().optional(),
          client_business_id: z.string().optional(),
        }),
      )
      const me = result.data
      return {
        data: { id: me.id, name: me.name ?? null, clientBusinessId: me.client_business_id ?? null },
        usage: result.usage,
      }
    },

    async listUserBusinesses(credentials) {
      const result = await call(
        {
          name: 'me/businesses',
          path: '/me/businesses',
          params: { fields: 'id,name', limit: '2' },
          credentials,
        },
        listSchema(z.object({ id: z.string(), name: z.string().optional() })),
      )
      return {
        data: result.data.data.map((b) => ({ id: b.id, name: b.name ?? null })),
        usage: result.usage,
      }
    },

    async getBusiness(credentials, businessId) {
      const result = await call(
        {
          name: 'business',
          path: `/${encodeURIComponent(businessId)}`,
          params: { fields: 'id,name' },
          credentials,
        },
        z.object({ id: z.string(), name: z.string().optional() }),
      )
      return { data: { id: result.data.id, name: result.data.name ?? null }, usage: result.usage }
    },

    async listUserPages(credentials, page) {
      const result = await call(
        {
          name: 'me/accounts',
          path: '/me/accounts',
          params: { fields: `${pageFields},access_token,tasks`, ...paging(page) },
          credentials,
        },
        listSchema(pageSchema),
      )
      return { data: toMetaPage(result.data, toPage), usage: result.usage }
    },

    async listAssignedInstagramAccounts(credentials, page) {
      const result = await call(
        {
          name: 'me/assigned_instagram_accounts',
          path: '/me/assigned_instagram_accounts',
          params: { fields: igAccountFields, ...paging(page) },
          credentials,
        },
        listSchema(igAccountSchema),
      )
      return { data: toMetaPage(result.data, toIgAccount), usage: result.usage }
    },

    async listBusinessPages(credentials, { businessId, relation, ...page }) {
      const edge = relation === 'owned' ? 'owned_pages' : 'client_pages'
      const fields = relation === 'client' ? `${pageFields},permitted_tasks` : pageFields
      const result = await call(
        {
          name: `business/${edge}`,
          path: `/${encodeURIComponent(businessId)}/${edge}`,
          params: { fields, ...paging(page) },
          credentials,
        },
        listSchema(pageSchema),
      )
      return { data: toMetaPage(result.data, toPage), usage: result.usage }
    },

    async listBusinessInstagramAccounts(credentials, { businessId, ...page }) {
      const result = await call(
        {
          name: 'business/instagram_business_accounts',
          path: `/${encodeURIComponent(businessId)}/instagram_business_accounts`,
          params: { fields: igAccountFields, ...paging(page) },
          credentials,
        },
        listSchema(igAccountSchema),
      )
      return { data: toMetaPage(result.data, toIgAccount), usage: result.usage }
    },

    async getInstagramAccount(credentials, igUserId) {
      const result = await call(
        {
          name: 'ig_user',
          path: `/${encodeURIComponent(igUserId)}`,
          params: { fields: igAccountFields },
          credentials,
        },
        igAccountSchema,
      )
      return { data: toIgAccount(result.data), usage: result.usage }
    },

    async getPublishingLimit(credentials, igUserId, signal) {
      const result = await call(
        {
          name: 'ig_user/content_publishing_limit',
          path: `/${encodeURIComponent(igUserId)}/content_publishing_limit`,
          params: { fields: 'quota_usage,config' },
          credentials,
          signal,
        },
        z.object({
          data: z
            .array(
              z.object({
                quota_usage: z.number(),
                config: z.object({ quota_total: z.number(), quota_duration: z.number() }),
              }),
            )
            .min(1),
        }),
      )
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the schema asks for one item
      const limit = result.data.data[0]!
      return {
        data: {
          quotaUsage: limit.quota_usage,
          quotaTotal: limit.config.quota_total,
          quotaDurationSeconds: limit.config.quota_duration,
        },
        usage: result.usage,
      }
    },

    async createInstagramContainer(credentials, igUserId, params, signal) {
      return call(
        {
          name: 'ig_user/media',
          method: 'POST',
          // Instagram fetches the file while it makes the container (0.13.0 test: 10 s were not enough)
          fetchesFile: true,
          path: `/${encodeURIComponent(igUserId)}/media`,
          params,
          credentials,
          signal,
        },
        z.object({ id: objectId }),
      )
    },

    async getContainerStatus(credentials, containerId, signal) {
      const result = await call(
        {
          name: 'ig_container',
          path: `/${encodeURIComponent(containerId)}`,
          params: { fields: 'status_code,status' },
          credentials,
          signal,
        },
        z.object({ status_code: z.string().optional(), status: z.string().optional() }),
      )
      const code = result.data.status_code
      return {
        data: {
          statusCode: CONTAINER_STATUSES.find((s) => s === code) ?? 'UNKNOWN',
          status: result.data.status ?? null,
        },
        usage: result.usage,
      }
    },

    async publishInstagramContainer(credentials, igUserId, containerId, signal) {
      return call(
        {
          name: 'ig_user/media_publish',
          method: 'POST',
          retry: false,
          // a ready container still took more than 10 s to publish in the 0.13.0 test
          fetchesFile: true,
          path: `/${encodeURIComponent(igUserId)}/media_publish`,
          params: { creation_id: containerId },
          credentials,
          signal,
        },
        z.object({ id: objectId }),
      )
    },

    async listInstagramMedia(credentials, igUserId, { edge, limit }, signal) {
      const result = await call(
        {
          name: `ig_user/${edge}`,
          path: `/${encodeURIComponent(igUserId)}/${edge}`,
          params: { fields: igMediaFields, limit: String(limit) },
          credentials,
          signal,
        },
        listSchema(igMediaSchema),
      )
      return { data: result.data.data.map(toIgMedia), usage: result.usage }
    },

    async getInstagramMedia(credentials, mediaId, signal) {
      const result = await call(
        {
          name: 'ig_media',
          path: `/${encodeURIComponent(mediaId)}`,
          params: { fields: igMediaFields },
          credentials,
          signal,
        },
        igMediaSchema,
      )
      return { data: toIgMedia(result.data), usage: result.usage }
    },

    async getPageAccessToken(credentials, pageId, signal) {
      const result = await call(
        {
          name: 'page/access_token',
          path: `/${encodeURIComponent(pageId)}`,
          params: { fields: 'access_token' },
          credentials,
          signal,
        },
        z.object({ access_token: z.string().min(1).optional() }),
      )
      return { data: { accessToken: result.data.access_token ?? null }, usage: result.usage }
    },

    async createPagePhoto(credentials, pageId, params, signal) {
      const result = await call(
        {
          name: 'page/photos',
          method: 'POST',
          // a published photo is a post: never twice
          retry: params.published === 'false',
          fetchesFile: true,
          path: `/${encodeURIComponent(pageId)}/photos`,
          params,
          credentials,
          signal,
        },
        z.object({ id: objectId, post_id: postId.optional() }),
      )
      return {
        data: { id: result.data.id, postId: result.data.post_id ?? null },
        usage: result.usage,
      }
    },

    async createPageFeedPost(credentials, pageId, params, signal) {
      return call(
        {
          name: 'page/feed',
          method: 'POST',
          retry: false,
          path: `/${encodeURIComponent(pageId)}/feed`,
          params,
          credentials,
          signal,
        },
        z.object({ id: postId }),
      )
    },

    async startPageVideoUpload(credentials, pageId, edge, signal) {
      // the answer's `upload_url` is not followed: the address is built here (`uploadHostedVideo`)
      const result = await call(
        {
          name: `page/${edge}/start`,
          method: 'POST',
          path: `/${encodeURIComponent(pageId)}/${edge}`,
          params: { upload_phase: 'start' },
          credentials,
          signal,
        },
        z.object({ video_id: objectId }),
      )
      return { data: { videoId: result.data.video_id }, usage: result.usage }
    },

    async uploadHostedVideo(credentials, videoId, fileUrl, signal) {
      return call(
        {
          name: 'video-upload',
          method: 'POST',
          host: 'upload',
          fetchesFile: true,
          path: `/${encodeURIComponent(videoId)}`,
          headers: { file_url: fileUrl },
          credentials,
          signal,
        },
        z.object({ success: z.boolean() }),
      )
    },

    async uploadVideoThumbnail(credentials, videoId, image, signal) {
      const result = await call(
        {
          name: 'video/thumbnails',
          method: 'POST',
          path: `/${encodeURIComponent(videoId)}/thumbnails`,
          params: { is_preferred: 'true' },
          file: {
            field: 'source',
            name: image.contentType === 'image/png' ? 'cover.png' : 'cover.jpg',
            bytes: image.bytes,
            contentType: image.contentType,
          },
          credentials,
          signal,
        },
        z.object({ success: z.boolean() }),
      )
      return result
    },

    async finishPageVideoUpload(credentials, pageId, edge, params, signal) {
      const result = await call(
        {
          name: `page/${edge}/finish`,
          method: 'POST',
          retry: false,
          path: `/${encodeURIComponent(pageId)}/${edge}`,
          params: { ...params, upload_phase: 'finish' },
          credentials,
          signal,
        },
        z.object({ success: z.boolean(), post_id: postId.optional() }),
      )
      return {
        data: { success: result.data.success, postId: result.data.post_id ?? null },
        usage: result.usage,
      }
    },

    async createPageVideo(credentials, pageId, params, signal) {
      return call(
        {
          name: 'page/videos',
          method: 'POST',
          retry: false,
          fetchesFile: true,
          path: `/${encodeURIComponent(pageId)}/videos`,
          params,
          credentials,
          signal,
        },
        z.object({ id: objectId }),
      )
    },

    async createPagePhotoStory(credentials, pageId, photoId, signal) {
      const result = await call(
        {
          name: 'page/photo_stories',
          method: 'POST',
          retry: false,
          path: `/${encodeURIComponent(pageId)}/photo_stories`,
          params: { photo_id: photoId },
          credentials,
          signal,
        },
        z.object({ success: z.boolean(), post_id: postId.optional() }),
      )
      return {
        data: { success: result.data.success, postId: result.data.post_id ?? null },
        usage: result.usage,
      }
    },

    async getFacebookVideo(credentials, videoId, signal) {
      const result = await call(
        {
          name: 'fb_video',
          path: `/${encodeURIComponent(videoId)}`,
          params: { fields: 'status,permalink_url' },
          credentials,
          signal,
        },
        fbVideoSchema,
      )
      const v = result.data
      return {
        data: {
          id: v.id,
          videoStatus: v.status?.video_status ?? null,
          uploadingStatus: v.status?.uploading_phase?.status ?? null,
          processingStatus: v.status?.processing_phase?.status ?? null,
          publishingStatus: v.status?.publishing_phase?.status ?? null,
          publishStatus: v.status?.publishing_phase?.publish_status ?? null,
          permalink: v.permalink_url ?? null,
        },
        usage: result.usage,
      }
    },

    async getFacebookPost(credentials, id, signal) {
      const result = await call(
        {
          name: 'fb_post',
          path: `/${encodeURIComponent(id)}`,
          params: { fields: 'is_published,permalink_url' },
          credentials,
          signal,
        },
        fbPostSchema,
      )
      return { data: toFbPost(result.data), usage: result.usage }
    },

    async listPagePublished(credentials, pageId, { edge, limit }, signal) {
      const result = await call(
        {
          name: `page/${edge}`,
          path: `/${encodeURIComponent(pageId)}/${edge}`,
          params: {
            fields: edge === 'published_posts' ? fbPostFields : fbVideoListFields,
            limit: String(limit),
          },
          credentials,
          signal,
        },
        listSchema(z.unknown()),
      )
      // one odd item is left out: it must not stop the search of the others (§9.5)
      const items = result.data.data.flatMap((item) => {
        const parsed = fbPostSchema.safeParse(item)
        return parsed.success ? [toFbPost(parsed.data)] : []
      })
      return { data: items, usage: result.usage }
    },

    async listPageStories(credentials, pageId, limit, signal) {
      const result = await call(
        {
          name: 'page/stories',
          path: `/${encodeURIComponent(pageId)}/stories`,
          params: { limit: String(limit) },
          credentials,
          signal,
        },
        listSchema(z.unknown()),
      )
      const stories = result.data.data.flatMap((item) => {
        const parsed = fbStorySchema.safeParse(item)
        return parsed.success ? [parsed.data] : []
      })
      return {
        data: stories.map((s) => ({
          postId: s.post_id,
          status: s.status ?? null,
          createdAt: storyDate(s.creation_time),
          mediaType: s.media_type ?? null,
          permalink: s.url ?? null,
        })),
        usage: result.usage,
      }
    },

    async deleteObject(credentials, objectId, signal) {
      return call(
        {
          name: 'object/delete',
          method: 'DELETE',
          path: `/${encodeURIComponent(objectId)}`,
          credentials,
          signal,
        },
        z.object({ success: z.boolean() }),
      )
    },
  }
}

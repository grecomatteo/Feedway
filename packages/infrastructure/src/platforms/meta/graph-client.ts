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
}

export interface MetaGraphClientOptions {
  mode: MetaMode
  version: string
  /** Required in `mock` (the fake Graph API serves both the API and the login dialog). */
  baseUrl?: string
  clock: Clock
  logger: Logger
  timeoutMs?: number
  /** First wait between attempts; grows and is randomized. */
  retryBaseDelayMs?: number
  /** META_RECORD_DIR: redacted answers for Task 13. Used only in `live`. */
  recordDir?: string | null
}

const GRAPH_HOST = 'https://graph.facebook.com'
const DIALOG_HOST = 'https://www.facebook.com'
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
}

export function createMetaGraphClient(opts: MetaGraphClientOptions): MetaGraphClient {
  if (opts.mode === 'mock' && opts.baseUrl === undefined)
    throw new Error('META_MODE=mock needs the address of the fake Graph API')
  const graphBase = `${opts.baseUrl ?? GRAPH_HOST}/${opts.version}`
  const dialogBase = `${opts.baseUrl ?? DIALOG_HOST}/${opts.version}`
  const timeoutMs = opts.timeoutMs ?? 10_000
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
      : { id: `dry-run-${randomBytes(8).toString('hex')}` }
    opts.logger.info({ metaCall: spec.name, method }, 'meta call skipped (dry-run)')
    const parsed = schema.safeParse(body)
    if (!parsed.success) throw new MetaError({ kind: 'uncertain', reason: 'invalid_response' })
    return { data: parsed.data, usage: { app: null, business: [] } }
  }

  async function attempt<T>(spec: CallSpec, schema: z.ZodType<T>): Promise<MetaResult<T>> {
    const skipped = dryRun(spec, schema)
    if (skipped !== null) return skipped
    const url = new URL(`${graphBase}${spec.path}`)
    const method = spec.method ?? 'GET'
    const form = new URLSearchParams()
    for (const [k, v] of Object.entries(spec.params ?? {}))
      if (method === 'POST') form.set(k, v)
      else url.searchParams.set(k, v)
    const headers: Record<string, string> = { accept: 'application/json' }
    if (spec.credentials !== undefined) {
      headers.authorization = `Bearer ${spec.credentials.accessToken}`
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
      const timeout = AbortSignal.timeout(timeoutMs)
      res = await fetch(url, {
        method,
        headers,
        ...(method === 'POST' && { body: form }),
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
  }
}

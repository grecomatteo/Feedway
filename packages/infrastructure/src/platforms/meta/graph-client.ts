import { createHmac } from 'node:crypto'
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
  ): Promise<MetaResult<MetaPublishingLimit>>
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
const pageFields = `id,name,picture{url},instagram_business_account{${igAccountFields}}`

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

const errorSchema = z.object({
  error: z.object({
    code: z.number(),
    error_subcode: z.number().optional(),
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
  let recorded = 0

  async function record(name: string, status: number, body: unknown): Promise<void> {
    if (recordDir === null) return
    recorded += 1
    try {
      await mkdir(recordDir, { recursive: true })
      const file = join(
        recordDir,
        `${String(recorded).padStart(4, '0')}-${name.replaceAll('/', '_')}.json`,
      )
      await writeFile(file, JSON.stringify({ call: name, status, body: redact(body) }, null, 2))
    } catch (err) {
      opts.logger.warn({ metaCall: name, err }, 'meta recording failed')
    }
  }

  async function attempt<T>(spec: CallSpec, schema: z.ZodType<T>): Promise<MetaResult<T>> {
    const url = new URL(`${graphBase}${spec.path}`)
    for (const [k, v] of Object.entries(spec.params ?? {})) url.searchParams.set(k, v)
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
      res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
      text = await res.text()
    } catch (err) {
      // Meta may have acted on a request that timed out: never retried (plan 03, Task 3)
      if (err instanceof DOMException && err.name === 'TimeoutError')
        throw new MetaError({ kind: 'uncertain', reason: 'timeout' })
      throw new MetaError({ kind: 'transient', reason: 'meta_unavailable' })
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
        if (err.reason !== 'meta_unavailable' || n >= MAX_ATTEMPTS) throw err
        const wait = baseDelay * 2 ** (n - 1) * (0.5 + Math.random())
        await new Promise((resolve) => setTimeout(resolve, wait))
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

    async getPublishingLimit(credentials, igUserId) {
      const result = await call(
        {
          name: 'ig_user/content_publishing_limit',
          path: `/${encodeURIComponent(igUserId)}/content_publishing_limit`,
          params: { fields: 'quota_usage,config' },
          credentials,
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
  }
}

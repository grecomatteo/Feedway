import { z } from 'zod'

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * Who may call a route. `session`: an active session; `session_any_state`: also a session that
 * still owes the second factor (the request middleware lets it through only where
 * `allowedWhileSecondFactorRequired` says so).
 */
export type ApiAuth = 'public' | 'session' | 'session_any_state'

/**
 * Whose data the route touches; decides which part of the isolation battery (Task 21) it
 * joins. `organization` routes live under `/api/v1/orgs/{org}/`, `platform` routes (the
 * platform administrator only) under `/api/v1/platform/`.
 */
export type ApiScope = 'organization' | 'personal' | 'platform' | 'public'

export interface ApiRequest {
  /** z.strictObject with one key per `{param}` of the path */
  params?: z.ZodType
  /** z.strictObject: unknown query keys are refused */
  query?: z.ZodType
  /** z.strictObject: unknown keys are refused, never dropped in silence */
  body?: z.ZodType
}

export interface ApiContract<
  R extends ApiRequest = ApiRequest,
  Res extends z.ZodType = z.ZodType,
  A extends ApiAuth = ApiAuth,
  S extends ApiScope = ApiScope,
> {
  method: ApiMethod
  /** OpenAPI form: `/api/v1/links/{token}` */
  path: `/api/${string}`
  summary: string
  request: R
  /** The DTO: the answer is parsed with it, so a field it does not list never leaves. */
  response: Res
  auth: A
  scope: S
  /** Largest JSON body accepted, in bytes (default 16 KiB). */
  maxBodyBytes?: number
  /**
   * The body is `multipart/form-data` with one file in the part `file`, of at most `maxBytes`
   * (the route reads no more than that, plus the multipart framing). No JSON `body` then.
   */
  upload?: { maxBytes: number }
  /** The answer is a file of this media type, not JSON: `response` is then `FileResponse`. */
  download?: { contentType: string }
}

/** What a download route hands back: the bytes and how the client may keep them. */
export interface FileAnswer {
  body: Uint8Array | AsyncIterable<Uint8Array>
  size: number
  /** A strong validator; a request with the same `If-None-Match` gets 304 and no body. */
  etag?: string
  cacheControl?: string
  /** Saved under this name (`Content-Disposition: attachment`) instead of shown. */
  filename?: string
}

export const FileResponse = z.custom<FileAnswer>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    'body' in value &&
    typeof (value as { size?: unknown }).size === 'number',
)

/** Keeps the literal types, so a route handler knows its session and actor are there. */
export function defineContract<
  const R extends ApiRequest,
  const Res extends z.ZodType,
  const A extends ApiAuth,
  const S extends ApiScope,
>(contract: ApiContract<R, Res, A, S>): ApiContract<R, Res, A, S> {
  return contract
}

export const ApiIssue = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
})
export type ApiIssue = z.infer<typeof ApiIssue>

/** The body of every error of `/api/v1` (spec §15.3: a generic message and the request id). */
export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    issues: z.array(ApiIssue).optional(),
    reason: z.string().optional(),
  }),
})
export type ApiErrorBody = z.infer<typeof ApiErrorBody>

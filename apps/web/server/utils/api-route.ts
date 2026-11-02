import { STATUS_CODES } from 'node:http'
import { Readable } from 'node:stream'
import type { H3Event } from 'h3'
import type { z } from 'zod'
import type { ApiContract, FileAnswer } from '@app/contracts'
import type { ResolvedSession } from '@app/application'
import type { OrgActor, PlatformActor } from '@app/domain'
import { HttpProblem, failureEntry, issuesFromZod, toErrorResponse } from './http-errors'

const DEFAULT_MAX_BODY_BYTES = 16 * 1024
const JSON_TYPE = /^application\/json\s*(;|$)/i
/** Room for the multipart boundaries and part headers around an uploaded file. */
const MULTIPART_FRAMING_BYTES = 16 * 1024

type Out<T> = T extends z.ZodType ? z.output<T> : undefined

export interface ApiContext<C extends ApiContract> {
  event: H3Event
  params: Out<C['request']['params']>
  query: Out<C['request']['query']>
  body: Out<C['request']['body']>
  /** The uploaded file of an `upload` route, already within its limit. */
  file: C['upload'] extends { maxBytes: number } ? Buffer : undefined
  /** null only on a public route without a session */
  session: C['auth'] extends 'public' ? ResolvedSession | null : ResolvedSession
  actor: C['scope'] extends 'organization'
    ? OrgActor
    : C['scope'] extends 'platform'
      ? PlatformActor
      : null
  /** written by our proxy middleware (05.client-ip), never by the client */
  ip: string | null
  userAgent: string | null
}

export interface ApiRouteOptions {
  /** Requests per client address, shared by every route with the same name. */
  rateLimit?: { name: string; limit: number; windowMs: number }
}

/** Logs an unexpected failure without its message (failureForLog) and answers it. */
export function sendApiError(event: H3Event, error: unknown) {
  const requestId = requestIdOf(event)
  const answer = toErrorResponse(error, requestId)
  if (answer.unexpected) logFailure(event, error)
  setResponseStatus(event, answer.status, STATUS_CODES[answer.status] ?? 'Error')
  for (const [name, value] of Object.entries(answer.headers)) setResponseHeader(event, name, value)
  setResponseHeader(event, 'content-type', 'application/json')
  return answer.body
}

export function logFailure(event: H3Event, error: unknown): void {
  const entry = failureEntry(
    { requestId: requestIdOf(event), method: event.method, path: event.path },
    error,
  )
  try {
    useDeps().logger.error(entry, 'unhandled error')
  } catch {
    console.error('unhandled error before startup finished', JSON.stringify(entry))
  }
}

function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)
  if (!result.success) throw new HttpProblem('VALIDATION', { issues: issuesFromZod(result.error) })
  return result.data
}

async function readJsonBody(event: H3Event, maxBytes: number): Promise<unknown> {
  if (!JSON_TYPE.test(getRequestHeader(event, 'content-type') ?? ''))
    throw new HttpProblem('UNSUPPORTED_MEDIA_TYPE')
  if (Number(getRequestHeader(event, 'content-length') ?? 0) > maxBytes)
    throw new HttpProblem('REQUEST_TOO_LARGE')
  // already capped by middleware/03.request-body for bodies without a length
  const raw = await readRawBody(event, false)
  if (raw === undefined || raw.length === 0) return undefined
  if (raw.length > maxBytes) throw new HttpProblem('REQUEST_TOO_LARGE')
  try {
    return JSON.parse(raw.toString('utf8')) as unknown
  } catch {
    throw new HttpProblem('BAD_REQUEST')
  }
}

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024))

/**
 * The one file of a multipart body. A declared length over the limit is refused before
 * anything is read; a body without one was already bounded while read (middleware/03).
 */
async function readUpload(event: H3Event, maxBytes: number): Promise<Buffer> {
  const mediaType = (getRequestHeader(event, 'content-type') ?? '').split(';')[0] ?? ''
  if (mediaType.trim().toLowerCase() !== 'multipart/form-data')
    throw new HttpProblem('UNSUPPORTED_MEDIA_TYPE')
  const tooLarge = () =>
    new HttpProblem('FILE_TOO_LARGE', {
      message: `Il file può pesare al massimo ${String(megabytes(maxBytes))} MB`,
    })
  const limit = maxBytes + MULTIPART_FRAMING_BYTES
  if (Number(getRequestHeader(event, 'content-length') ?? 0) > limit) {
    setResponseHeader(event, 'connection', 'close')
    throw tooLarge()
  }
  const raw = await readRawBody(event, false)
  if (raw !== undefined && raw.length > limit) throw tooLarge()
  const parts = raw === undefined || raw.length === 0 ? [] : await readMultipartFormData(event)
  const noFile = () =>
    new HttpProblem('VALIDATION', {
      issues: [{ path: ['file'], message: 'Scegli un file' }],
    })
  if (!parts || parts.length !== 1) throw noFile()
  const [part] = parts
  if (part?.name !== 'file' || part.filename === undefined) throw noFile()
  if (part.data.length > maxBytes) throw tooLarge()
  return part.data
}

/** A download route's answer: the bytes, or 304 when the client already holds this version. */
async function sendFile(event: H3Event, contentType: string, answer: FileAnswer) {
  setResponseHeader(event, 'content-type', contentType)
  if (answer.cacheControl) setResponseHeader(event, 'cache-control', answer.cacheControl)
  if (answer.filename)
    setResponseHeader(
      event,
      'content-disposition',
      `attachment; filename="${answer.filename.replace(/[^\w.-]/g, '_')}"`,
    )
  const release = () => {
    // a stored file stays open until its body is read or abandoned
    if (!(answer.body instanceof Uint8Array)) void answer.body[Symbol.asyncIterator]().return?.()
  }
  if (answer.etag !== undefined) {
    const tag = `"${answer.etag}"`
    setResponseHeader(event, 'etag', tag)
    const asked = getRequestHeader(event, 'if-none-match') ?? ''
    if (asked.split(',').some((t) => t.trim().replace(/^W\//, '') === tag)) {
      release()
      setResponseStatus(event, 304)
      return null
    }
  }
  setResponseHeader(event, 'content-length', answer.size)
  if (answer.body instanceof Uint8Array) return Buffer.from(answer.body)
  await sendStream(event, Readable.from(answer.body))
  return null
}

async function limit(event: H3Event, rule: NonNullable<ApiRouteOptions['rateLimit']>) {
  const ip = getRequestHeader(event, 'x-app-client-ip') ?? 'unknown'
  const hit = await useDeps().rateLimiter.hit(`ip:${rule.name}:${ip}`, rule.limit, rule.windowMs)
  if (!hit.allowed)
    throw new HttpProblem('RATE_LIMITED', { retryAfterSeconds: Math.ceil(hit.retryAfterMs / 1000) })
}

async function authorize(event: H3Event, auth: ApiContract['auth']) {
  if (auth === 'session') return requireActiveSession(event)
  const session = await loadSession(event)
  if (auth === 'session_any_state' && !session) throw new HttpProblem('UNAUTHENTICATED')
  return session
}

/**
 * The platform administrator, from the session. Anyone else gets 404: the routes do not exist
 * for them. The use case reads the role again inside its transaction (`platformAuthor`).
 */
function platformActorOf(session: ResolvedSession | null): PlatformActor {
  if (session?.user.platformRole !== 'admin') throw new HttpProblem('NOT_FOUND')
  return { userId: session.user.id, platformRole: 'admin' }
}

/**
 * A thin `/api/v1` route over its contract (packages/contracts): limits, then session, then
 * agency, then input. So an anonymous caller gets 401 and an invisible agency 404 before any
 * validation could describe the route. The answer is parsed with the response DTO, so a field
 * the contract does not list never leaves; every error goes through http-errors.ts.
 */
export function defineApiRoute<C extends ApiContract>(
  contract: C,
  handler: (ctx: ApiContext<C>) => Promise<z.input<C['response']>> | z.input<C['response']>,
  options: ApiRouteOptions = {},
) {
  const pattern = contract.path.replace(/\{(\w+)\}/g, ':$1')
  return defineEventHandler(async (event) => {
    try {
      if (event.method !== contract.method) throw new HttpProblem('NOT_FOUND')
      const matched = (event.context.matchedRoute as { path?: string } | undefined)?.path
      // a route file wired to the wrong contract would document one route and serve another
      if (matched !== undefined && matched !== pattern)
        throw new Error('route file and contract disagree')
      // a public route counts every caller; any other only callers with a session, so an
      // anonymous flood cannot use up the allowance of people behind the same address
      const isPublic = contract.auth === 'public'
      if (options.rateLimit && isPublic) await limit(event, options.rateLimit)
      const session = await authorize(event, contract.auth)
      // before the limit: someone else behind the administrator's address must not use up
      // their allowance, nor learn from a 429 that the route exists
      const platformActor = contract.scope === 'platform' ? platformActorOf(session) : null
      if (options.rateLimit && !isPublic) await limit(event, options.rateLimit)
      const actor = contract.scope === 'organization' ? await requireOrgActor(event) : platformActor
      const { params, query, body } = contract.request
      const ctx = {
        event,
        params: params ? parse(params, getRouterParams(event, { decode: true })) : undefined,
        query: query ? parse(query, getQuery(event)) : undefined,
        body: body
          ? parse(body, await readJsonBody(event, contract.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES))
          : undefined,
        file: contract.upload ? await readUpload(event, contract.upload.maxBytes) : undefined,
        session,
        actor,
        ip: getRequestHeader(event, 'x-app-client-ip') ?? null,
        userAgent: getRequestHeader(event, 'user-agent') ?? null,
      } as ApiContext<C>
      const answer = contract.response.safeParse(await handler(ctx))
      if (!answer.success) throw new Error('answer does not match the response contract')
      if (contract.download)
        return await sendFile(event, contract.download.contentType, answer.data as FileAnswer)
      return answer.data
    } catch (error) {
      return sendApiError(event, error)
    }
  })
}

/** The link routes together: 20 requests a minute per address (Task 12). */
export const LINKS_RATE_LIMIT = { name: 'links', limit: 20, windowMs: 60_000 }

/** Password guesses on a stolen session; the use case also limits each person (Task 13). */
export const REAUTH_RATE_LIMIT = { name: 'reauth', limit: 10, windowMs: 60_000 }

/** Each invite is a live link: a stolen session must not mint them in bulk. */
export const INVITES_RATE_LIMIT = { name: 'invites', limit: 30, windowMs: 60_000 }

/** Each change of the system email is a reauth-protected write: a few a minute are plenty. */
export const PLATFORM_SETTINGS_RATE_LIMIT = {
  name: 'platform-settings',
  limit: 10,
  windowMs: 60_000,
}

/** Each test is an email to an address; the use case also limits each administrator (5/10 min). */
export const MAIL_TEST_RATE_LIMIT_ROUTE = { name: 'mail-test', limit: 5, windowMs: 60_000 }

/** Each reset link takes over an account if it leaks. */
export const RESET_LINKS_RATE_LIMIT = { name: 'reset-links', limit: 10, windowMs: 60_000 }

/** Each photo is decoded and resized: a stolen session must not keep the server busy. */
export const AVATAR_RATE_LIMIT = { name: 'avatar', limit: 30, windowMs: 10 * 60_000 }

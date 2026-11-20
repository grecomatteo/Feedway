import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { DOMAIN_ERROR_CODES, DomainError } from '@app/domain'
import { ApiErrorBody } from '@app/contracts'
import {
  ERROR_STATUS,
  HttpProblem,
  failureEntry,
  failureForLog,
  isClientGone,
  issuesFromZod,
  toErrorResponse,
} from '../server/utils/http-errors.ts'

const it = JSON.parse(
  readFileSync(new URL('../i18n/locales/it.json', import.meta.url), 'utf8'),
) as { errors: Record<string, unknown>; errorReasons: Record<string, unknown> }

const REQUEST_ID = '01a17295-79bc-75e9-a3fb-d577e68e5dfd'

// the table of Task 19, as written in the plan
const PLAN_TABLE: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  REAUTH_REQUIRED: 403,
  SECOND_FACTOR_REQUIRED: 403,
  ORGANIZATION_SUSPENDED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  LIMIT_REACHED: 409,
  SOLE_OWNER: 409,
  MAIL_NOT_CONFIGURED: 409,
  LINK_INVALID: 410,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  VALIDATION: 422,
  RATE_LIMITED: 429,
}

test('email errors: not configured is a state of the platform, a failed send an upstream error', () => {
  expect(ERROR_STATUS.MAIL_NOT_CONFIGURED).toBe(409)
  expect(ERROR_STATUS.MAIL_SEND_FAILED).toBe(502)
  const r = toErrorResponse(new DomainError('MAIL_SEND_FAILED', ''), REQUEST_ID)
  expect(r).toMatchObject({ status: 502, unexpected: false })
  expect(r.body.error.message).toBe(it.errors['MAIL_SEND_FAILED'])
})

test('every domain error code has a status and an italian message', () => {
  for (const code of DOMAIN_ERROR_CODES) {
    expect(ERROR_STATUS[code], code).toEqual(expect.any(Number))
    expect(it.errors[code], code).toEqual(expect.any(String))
  }
})

test('every code of the table has a message, and the statuses are those of the plan', () => {
  for (const [code, status] of Object.entries(PLAN_TABLE))
    expect(ERROR_STATUS[code as keyof typeof ERROR_STATUS]).toBe(status)
  for (const code of Object.keys(ERROR_STATUS))
    expect(it.errors[code], code).toEqual(expect.any(String))
})

test('a failed reauth is 403, not the 401 of a session that is gone (Task 20)', () => {
  const r = toErrorResponse(new DomainError('REAUTH_FAILED', 'Password non corretta'), REQUEST_ID)
  expect(r.status).toBe(403)
  expect(r.body.error).toEqual({
    code: 'REAUTH_FAILED',
    message: 'Password non corretta',
    requestId: REQUEST_ID,
  })
})

test('every reason has a message', () => {
  expect(it.errorReasons['use_existing_factor']).toEqual(expect.any(String))
})

describe('toErrorResponse', () => {
  test('a domain error keeps its italian message and gets the body of the contract', () => {
    const r = toErrorResponse(new DomainError('LINK_INVALID', 'Il link è scaduto'), REQUEST_ID)
    expect(r.status).toBe(410)
    expect(r.unexpected).toBe(false)
    expect(ApiErrorBody.parse(r.body)).toEqual({
      error: { code: 'LINK_INVALID', message: 'Il link è scaduto', requestId: REQUEST_ID },
    })
  })

  test('a domain validation error names its field as an issue, and no other detail leaks', () => {
    const r = toErrorResponse(
      new DomainError('VALIDATION', 'La password non è abbastanza robusta', {
        field: 'password',
        internal: 'x',
      }),
      REQUEST_ID,
    )
    expect(r.status).toBe(422)
    expect(r.body.error.issues).toEqual([
      { path: ['password'], message: 'La password non è abbastanza robusta' },
    ])
    expect(JSON.stringify(r.body)).not.toContain('internal')
  })

  test('a rate limit answers 429 with Retry-After', () => {
    const r = toErrorResponse(
      new DomainError('RATE_LIMITED', 'Troppi tentativi', { retryAfterSeconds: 42 }),
      REQUEST_ID,
    )
    expect(r.status).toBe(429)
    expect(r.headers['retry-after']).toBe('42')
    const fallback = toErrorResponse(new HttpProblem('RATE_LIMITED'), REQUEST_ID)
    expect(fallback.headers['retry-after']).toMatch(/^\d+$/)
  })

  test('a second factor refusal carries its reason', () => {
    const r = toErrorResponse(
      new HttpProblem('SECOND_FACTOR_REQUIRED', { reason: 'use_existing_factor' }),
      REQUEST_ID,
    )
    expect(r.status).toBe(403)
    expect(r.body.error).toMatchObject({
      code: 'SECOND_FACTOR_REQUIRED',
      reason: 'use_existing_factor',
      message: it.errorReasons['use_existing_factor'],
    })
  })

  test('a domain conflict carries a known reason, never an unknown one', () => {
    const r = toErrorResponse(
      new DomainError('CONFLICT', 'Il file si sta già completando', {
        reason: 'upload_completing',
      }),
      REQUEST_ID,
    )
    expect(r.status).toBe(409)
    expect(r.body.error).toMatchObject({ reason: 'upload_completing' })
    const unknown = toErrorResponse(
      new DomainError('CONFLICT', 'Altro', { reason: 'select * from users' }),
      REQUEST_ID,
    )
    expect(unknown.body.error).not.toHaveProperty('reason')
  })

  test('«Riprendi» with the time passed tells the panel to ask for a new one (plan 07 Task 9)', () => {
    const r = toErrorResponse(
      new DomainError('VALIDATION', 'L’ora del post è passata: scegli quando pubblicarlo', {
        field: 'when',
        reason: 'paused_time_passed',
      }),
      REQUEST_ID,
    )
    expect(r.status).toBe(422)
    expect(r.body.error).toMatchObject({ reason: 'paused_time_passed' })
  })

  test('a post that cannot be scheduled carries its checks, as post-checks answers them', () => {
    const report = {
      outcomes: [
        {
          level: 'block',
          code: 'no_destinations',
          params: {},
          subject: { kind: 'post' },
          key: 'no_destinations:post',
        },
      ],
      destinations: [
        {
          accountId: 'a1',
          platform: 'instagram',
          format: 'reel',
          caption: 'x',
          media: [0],
          fingerprint: 'f'.repeat(64),
          outcomeKeys: [],
        },
      ],
      postKeys: ['no_destinations:post'],
      unresolved: [],
      invalidChoices: [{ key: 'k', option: 'accept' }],
      canSchedule: false,
      scheduledAt: new Date('2027-06-10T16:00:00Z'),
      adjustment: 'none',
    }
    const r = toErrorResponse(
      new DomainError('VALIDATION', 'Il post ha dei problemi', {
        reason: 'post_not_schedulable',
        report,
      }),
      REQUEST_ID,
    )
    expect(r.status).toBe(422)
    expect(ApiErrorBody.parse(r.body)).toEqual(r.body)
    expect(r.body.error.report).toMatchObject({
      canSchedule: false,
      scheduledAt: '2027-06-10T16:00:00.000Z',
      outcomes: [{ code: 'no_destinations' }],
    })
    // nothing of the history, no orphan choice
    expect(JSON.stringify(r.body)).not.toMatch(/fingerprint|invalidChoices/)
    // a report under any other reason never leaves
    const other = toErrorResponse(
      new DomainError('VALIDATION', 'Altro', { reason: 'upload_completing', report }),
      REQUEST_ID,
    )
    expect(other.body.error).not.toHaveProperty('report')
  })

  test('anything unknown is a generic 500 with the request id only', () => {
    const secret = new Error('insert into accounts values ($1) params: cavallo-batteria-graffetta')
    const r = toErrorResponse(secret, REQUEST_ID)
    expect(r.status).toBe(500)
    expect(r.unexpected).toBe(true)
    expect(r.body).toEqual({
      error: { code: 'INTERNAL', message: it.errors['INTERNAL'], requestId: REQUEST_ID },
    })
  })

  test('framework client errors keep their status but never their message', () => {
    const h3Like = Object.assign(new Error('Bad <script>alert(1)</script>'), {
      statusCode: 400,
      statusMessage: 'Bad Request',
    })
    const r = toErrorResponse(h3Like, REQUEST_ID)
    expect(r.status).toBe(400)
    expect(r.body.error.code).toBe('BAD_REQUEST')
    expect(JSON.stringify(r.body)).not.toContain('script')
    const notFound = toErrorResponse(Object.assign(new Error('x'), { statusCode: 404 }), REQUEST_ID)
    expect(notFound.body.error.code).toBe('NOT_FOUND')
    const huge = toErrorResponse(Object.assign(new Error('x'), { statusCode: 413 }), REQUEST_ID)
    expect(huge.body.error.code).toBe('REQUEST_TOO_LARGE')
    const crash = toErrorResponse(Object.assign(new Error('x'), { statusCode: 503 }), REQUEST_ID)
    expect(crash).toMatchObject({ status: 500, unexpected: true })
  })
})

describe('issuesFromZod', () => {
  const Body = z.strictObject({ name: z.string().min(1).max(5), password: z.string().max(8) })

  test('issues are in italian, with the path, and never echo what was sent', () => {
    const sent = { name: '', password: 'segreto-molto-lungo', extra: 'altro-segreto' }
    const issues = issuesFromZod(Body.safeParse(sent).error as z.ZodError)
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: ['name'], message: expect.any(String) as string },
        { path: ['password'], message: expect.any(String) as string },
        { path: ['extra'], message: expect.any(String) as string },
      ]),
    )
    expect(JSON.stringify(issues)).not.toMatch(/segreto|Too|Invalid|expected/)
  })

  test('a missing body is one issue at the root', () => {
    expect(issuesFromZod(Body.safeParse(undefined).error as z.ZodError)).toEqual([
      { path: [], message: expect.any(String) as string },
    ])
  })
})

test('the log of an unknown failure has its type, code and frames, never its message', () => {
  const error = Object.assign(new Error('duplicate key: params cavallo-batteria-graffetta'), {
    code: '23505',
  })
  const logged = failureForLog(error)
  expect(logged).toMatchObject({ type: 'Error', code: '23505' })
  expect(JSON.stringify(logged)).not.toContain('cavallo')
  expect(logged.frames.length).toBeGreaterThan(0)
})

test('a multi-line message cannot slip lines into the logged frames', () => {
  const error = new Error(
    'failed for cavallo-batteria\n    at leak (/tmp/batteria-graffetta.ts:1:1)\n    at x',
  )
  const logged = failureForLog(error)
  expect(JSON.stringify(logged)).not.toMatch(/cavallo|batteria|graffetta/)
  expect(logged.frames.length).toBeGreaterThan(0)
  expect(logged.frames[0]).toMatch(/^at /)
})

test('an error whose message is no longer in its stack logs no frames', () => {
  const error = new Error('original')
  error.stack = 'Error: rewritten cavallo\n    at leak (/tmp/batteria.ts:1:1)'
  expect(JSON.stringify(failureForLog(error))).not.toMatch(/cavallo|batteria/)
})

test('the logged entry of a failure hides link tokens and drops the query', () => {
  const entry = failureEntry(
    {
      requestId: REQUEST_ID,
      method: 'POST',
      path: '/api/v1/links/tok-cavallo/activate?x=batteria',
    },
    new Error('boom'),
  )
  expect(entry).toMatchObject({ requestId: REQUEST_ID, method: 'POST' })
  expect(entry.path).toBe('/api/v1/links/[REDACTED]/activate')
  expect(JSON.stringify(entry)).not.toMatch(/cavallo|batteria|boom/)
})

describe('isClientGone', () => {
  const coded = (code: string, cause?: unknown) =>
    Object.assign(new Error('socket', cause === undefined ? {} : { cause }), { code })
  test('a phone that loses the network during a piece is the client going away (D-41)', () => {
    expect(isClientGone(coded('ECONNRESET'), true)).toBe(true)
    expect(isClientGone(coded('ERR_STREAM_PREMATURE_CLOSE'), true)).toBe(true)
    expect(isClientGone(coded('ECONNABORTED'), true)).toBe(true)
    // wrapped by the code that read the body
    expect(isClientGone(new Error('piece not written', { cause: coded('ECONNRESET') }), true)).toBe(
      true,
    )
  })
  test('the same codes with the client still there are a failure of ours (database, storage)', () => {
    expect(isClientGone(new Error('query failed', { cause: coded('ECONNRESET') }), false)).toBe(
      false,
    )
    expect(isClientGone(coded('EPIPE'), false)).toBe(false)
  })
  test('anything else stays an unexpected failure', () => {
    expect(isClientGone(new Error('boom'), true)).toBe(false)
    expect(isClientGone(coded('ENOSPC'), true)).toBe(false)
    expect(isClientGone('ECONNRESET', true)).toBe(false)
  })
})

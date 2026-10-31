import type { FetchError } from 'ofetch'

/** The error body of our routes and of Better Auth, as far as the panel reads it. */
interface ErrorBody {
  error?: {
    code?: string
    message?: string
    reason?: string
    issues?: { path?: (string | number)[] }[]
  }
  code?: string
  message?: string
}

export interface ApiFailure {
  code: string
  message: string
  /** The field the error is about, to show it next to that field. */
  field: string | null
  /** HTTP status, 0 when the request never got an answer. */
  status: number
  /** Seconds to wait, from `Retry-After` on a 429. */
  retryAfter: number | null
  /** `reason` of a SECOND_FACTOR_REQUIRED answer. */
  reason: string | null
}

/**
 * Requests from the panel's pages: same origin, with the header the CSRF check asks for
 * (server/middleware/10.csrf.ts).
 */
export function useApi() {
  const i18n = useI18n()

  function failure(error: unknown): ApiFailure {
    const fetchError = error as FetchError<ErrorBody> | undefined
    const data = fetchError?.data
    const retry = Number(fetchError?.response?.headers.get('retry-after') ?? '')
    const code = data?.error?.code ?? data?.code ?? 'INTERNAL'
    const field = data?.error?.issues?.[0]?.path?.[0]?.toString() ?? null
    // Better Auth answers in English for its own codes: those have texts of ours (authErrors)
    const message = i18n.te(`authErrors.${code}`)
      ? i18n.t(`authErrors.${code}`)
      : (data?.error?.message ??
        data?.message ??
        (i18n.te(`errors.${code}`) ? i18n.t(`errors.${code}`) : ''))
    return {
      code,
      message: message === '' ? i18n.t('errors.INTERNAL') : message,
      field,
      status: fetchError?.statusCode ?? fetchError?.response?.status ?? 0,
      retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
      reason: data?.error?.reason ?? null,
    }
  }

  function call<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return $fetch<T>(path, {
      method,
      headers: { ...headers, 'x-app-request': '1' },
      ...(body === undefined ? {} : { body }),
    })
  }

  return { call, failure }
}

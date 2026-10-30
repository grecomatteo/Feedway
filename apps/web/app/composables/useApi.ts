import type { FetchError } from 'ofetch'

/** The error body of our routes and of Better Auth, as far as the panel reads it. */
interface ErrorBody {
  error?: { code?: string; message?: string; issues?: { path?: (string | number)[] }[] }
  code?: string
  message?: string
}

export interface ApiFailure {
  code: string
  message: string
  /** The field the error is about, to show it next to that field. */
  field: string | null
}

/**
 * Requests from the panel's pages: same origin, with the header the CSRF check asks for
 * (server/middleware/10.csrf.ts).
 */
export function useApi() {
  const i18n = useI18n()

  function failure(error: unknown): ApiFailure {
    const data = (error as FetchError<ErrorBody> | undefined)?.data
    const code = data?.error?.code ?? data?.code ?? 'INTERNAL'
    const field = data?.error?.issues?.[0]?.path?.[0]?.toString() ?? null
    // Better Auth answers in English for its own codes: those have texts of ours (authErrors)
    const message = i18n.te(`authErrors.${code}`)
      ? i18n.t(`authErrors.${code}`)
      : (data?.error?.message ??
        data?.message ??
        (i18n.te(`errors.${code}`) ? i18n.t(`errors.${code}`) : ''))
    return { code, message: message === '' ? i18n.t('errors.INTERNAL') : message, field }
  }

  function call<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
    return $fetch<T>(path, {
      method,
      headers: { 'x-app-request': '1' },
      ...(body === undefined ? {} : { body }),
    })
  }

  return { call, failure }
}

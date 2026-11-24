import {
  TelegramApiError,
  type TelegramBotApi,
  type TelegramFailureKind,
  type TelegramUpdate,
} from '@app/application'

// Telegram's Bot API over `fetch` (plan 08 Task 7, no library). The token is in the address of
// every call: it never goes into an error, and a `fetch` failure is replaced by our own error
// so that no stack or cause carries the address.

export const TELEGRAM_API_URL = 'https://api.telegram.org'

export interface TelegramBotApiOptions {
  /** api.telegram.org, or the fake Bot API (`tools/telegram-mock`) */
  baseUrl: URL
  /** How long a call may take beyond the long poll's own wait. */
  timeoutMs?: number
}

interface ApiAnswer {
  ok?: unknown
  result?: unknown
  error_code?: unknown
  parameters?: { retry_after?: unknown }
}

function kindOf(status: number, answer: ApiAnswer | null): TelegramFailureKind {
  const code = typeof answer?.error_code === 'number' ? answer.error_code : status
  if (code === 401 || code === 404) return 'unauthorized'
  if (code === 403) return 'blocked'
  if (code === 429) return 'rate_limited'
  if (code === 400) return 'bad_request'
  return 'unavailable'
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function updateOf(raw: unknown): TelegramUpdate | null {
  if (!isRecord(raw) || typeof raw.update_id !== 'number') return null
  const message = raw.message
  if (
    isRecord(message) &&
    isRecord(message.chat) &&
    message.chat.type === 'private' &&
    typeof message.chat.id === 'number' &&
    typeof message.text === 'string'
  )
    return { updateId: raw.update_id, message: { chatId: message.chat.id, text: message.text } }
  return { updateId: raw.update_id, message: null }
}

export function createTelegramBotApi(options: TelegramBotApiOptions): TelegramBotApi {
  const timeoutMs = options.timeoutMs ?? 10_000
  const base = options.baseUrl.toString().replace(/\/$/, '')

  async function call(
    token: string,
    method: string,
    body: object,
    waitSeconds: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(timeoutMs + waitSeconds * 1000)
    let response: Response
    let answer: ApiAnswer | null = null
    try {
      response = await fetch(`${base}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        redirect: 'error',
      })
      answer = (await response.json().catch(() => null)) as ApiAnswer | null
    } catch {
      // never the error itself: its cause holds the address, with the token in it
      throw new TelegramApiError('unavailable', method)
    }
    if (response.ok && answer?.ok === true) return answer.result
    const kind = kindOf(response.status, answer)
    const retryAfter = answer?.parameters?.retry_after
    throw new TelegramApiError(
      kind,
      method,
      kind === 'rate_limited' && typeof retryAfter === 'number' ? retryAfter : null,
    )
  }

  return {
    async getMe(token, signal) {
      const result = await call(token, 'getMe', {}, 0, signal)
      if (!isRecord(result) || typeof result.id !== 'number' || typeof result.username !== 'string')
        throw new TelegramApiError('unavailable', 'getMe')
      return { id: result.id, username: result.username }
    },

    async getUpdates(token, { offset, timeoutSeconds }, signal) {
      const result = await call(
        token,
        'getUpdates',
        { offset, timeout: timeoutSeconds, allowed_updates: ['message'] },
        timeoutSeconds,
        signal,
      )
      if (!Array.isArray(result)) throw new TelegramApiError('unavailable', 'getUpdates')
      return result.map(updateOf).filter((u): u is TelegramUpdate => u !== null)
    },

    async setMyCommands(token, commands, signal) {
      await call(token, 'setMyCommands', { commands }, 0, signal)
    },

    async sendMessage(token, message, signal) {
      await call(
        token,
        'sendMessage',
        {
          chat_id: message.chatId,
          text: message.html,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        },
        0,
        signal,
      )
    },
  }
}

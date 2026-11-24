/** Why a call to the Bot API did not work, as the adapter classifies it (plan 08 Task 7). */
export const TELEGRAM_FAILURE_KINDS = [
  /** The token is wrong or was revoked with @BotFather. */
  'unauthorized',
  /** The person blocked the bot, or never wrote to it: the chat is gone for this bot. */
  'blocked',
  /** 429: Telegram asks to wait `retryAfterSeconds`. */
  'rate_limited',
  /** Telegram refused the request as it was (an empty or too long text, an unknown chat). */
  'bad_request',
  /** No answer, a timeout, a 5xx or an answer that is not the Bot API's. */
  'unavailable',
] as const
export type TelegramFailureKind = (typeof TELEGRAM_FAILURE_KINDS)[number]

/**
 * A failed call, classified. The message never holds the token (it is in the address of every
 * call) nor what the person wrote: only the method and the kind.
 */
export class TelegramApiError extends Error {
  readonly kind: TelegramFailureKind
  readonly retryAfterSeconds: number | null

  constructor(kind: TelegramFailureKind, method: string, retryAfterSeconds: number | null = null) {
    super(`telegram ${method}: ${kind}`)
    this.name = 'TelegramApiError'
    this.kind = kind
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export interface TelegramBotIdentity {
  id: number
  username: string
}

/** What `telegram.poll` reads of an update: a text a person wrote to the bot in a private chat. */
export interface TelegramUpdate {
  updateId: number
  /** null: anything else (a group, a photo, an edit), confirmed and ignored */
  message: { chatId: number; text: string } | null
}

/**
 * Telegram's Bot API, with `fetch` (no library, plan 08 «Dipendenze nuove»). The token is an
 * argument of every call and never leaves the adapter in a log or an error.
 */
export interface TelegramBotApi {
  getMe(token: string, signal?: AbortSignal): Promise<TelegramBotIdentity>
  /** Long polling: waits up to `timeoutSeconds` for an update after `offset`. */
  getUpdates(
    token: string,
    options: { offset: number; timeoutSeconds: number },
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]>
  /** Plain text, no preview of the links. */
  sendMessage(
    token: string,
    /** `html` is for parse_mode HTML, already escaped (`notifications/telegram-format.ts`) */
    message: { chatId: number; html: string },
    signal?: AbortSignal,
  ): Promise<void>
}

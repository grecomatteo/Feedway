import type { TelegramApiError } from '../ports/telegram-bot-api.js'

// The long poll fails now and then on its own: Telegram closes the connection, a 5xx, a timeout
// (D-134). One such failure is not a fault and is logged at info; the alarm (an error in the log)
// goes off once a bot has failed many times in a row or for some minutes, is told again only now
// and then while it lasts, and its end is logged. A failure that will not pass by itself (a token
// refused, another poller on the same bot) raises the alarm at once.

export interface TelegramPollHealthOptions {
  /** Failures in a row before the alarm; 10 by default. */
  alarmAfterFailures?: number
  /** Or seconds failing, with at least two failures; 300 by default. */
  alarmAfterSeconds?: number
  /** While the alarm lasts, it is told again after this; 3600 by default. */
  remindAfterSeconds?: number
}

export type TelegramPollFailure =
  /** An isolated failure, as long polling has: info */
  | { log: 'passing'; failures: number }
  /** The alarm going off, or told again: error */
  | { log: 'alarm'; failures: number; failingSeconds: number }
  /** The alarm already told: debug */
  | { log: 'quiet'; failures: number; failingSeconds: number }

export interface TelegramPollRecovery {
  failures: number
  failingSeconds: number
  /** The alarm had gone off: the end is told at info */
  alarmed: boolean
}

/** One per worker process: it outlives the runs of `telegram.poll`, each bot by its key. */
export interface TelegramPollHealth {
  failed(bot: string, now: Date, options?: { lasting?: boolean }): TelegramPollFailure
  /** null: the bot was not failing */
  succeeded(bot: string, now: Date): TelegramPollRecovery | null
}

interface Streak {
  failures: number
  since: number
  /** When the alarm was told last; null: not yet */
  toldAt: number | null
}

export function createTelegramPollHealth(
  options: TelegramPollHealthOptions = {},
): TelegramPollHealth {
  const alarmAfterFailures = options.alarmAfterFailures ?? 10
  const alarmAfterMs = (options.alarmAfterSeconds ?? 300) * 1000
  const remindAfterMs = (options.remindAfterSeconds ?? 3600) * 1000
  const streaks = new Map<string, Streak>()

  return {
    failed(bot, now, { lasting = false } = {}) {
      const time = now.getTime()
      const streak = streaks.get(bot) ?? { failures: 0, since: time, toldAt: null }
      streak.failures += 1
      streaks.set(bot, streak)
      const failingMs = time - streak.since
      const failingSeconds = Math.round(failingMs / 1000)
      if (streak.toldAt !== null) {
        if (time - streak.toldAt < remindAfterMs)
          return { log: 'quiet', failures: streak.failures, failingSeconds }
      } else if (
        !lasting &&
        streak.failures < alarmAfterFailures &&
        (streak.failures < 2 || failingMs < alarmAfterMs)
      )
        return { log: 'passing', failures: streak.failures }
      streak.toldAt = time
      return { log: 'alarm', failures: streak.failures, failingSeconds }
    },
    succeeded(bot, now) {
      const streak = streaks.get(bot)
      if (streak === undefined) return null
      streaks.delete(bot)
      return {
        failures: streak.failures,
        failingSeconds: Math.round((now.getTime() - streak.since) / 1000),
        alarmed: streak.toldAt !== null,
      }
    },
  }
}

/** The longest wait between two tries within a run. */
const RETRY_MAX_SECONDS = 15

/** Before the `attempt`-th try again in a run: 1, 2, 4, 8, 15 s, or the wait a 429 asks for. */
export function telegramRetrySeconds(attempt: number, error: TelegramApiError): number {
  if (error.kind === 'rate_limited' && error.retryAfterSeconds !== null)
    return error.retryAfterSeconds
  return Math.min(2 ** Math.max(attempt - 1, 0), RETRY_MAX_SECONDS)
}

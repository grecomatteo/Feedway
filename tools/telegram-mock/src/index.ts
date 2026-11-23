import { startTelegramMock as startWith, type MockBot } from './server.ts'

export type { MockBot, SentMessage, TelegramMock, TelegramMockCall } from './server.ts'

/** The bots of the initial data, for tests and development: fake tokens, never a real one. */
export const TELEGRAM_MOCK = {
  bots: {
    platform: {
      token: '1000000001:AAmock-platform-bot-token-000000000',
      id: 1000000001,
      username: 'feedway_mock_bot',
      firstName: 'Feedway',
    },
    agency: {
      token: '1000000002:AAmock-agency-bot-token-0000000000',
      id: 1000000002,
      username: 'agenzia_mock_bot',
      firstName: 'Agenzia',
    },
  },
} as const satisfies { bots: Record<string, MockBot> }

/** How many more agency bots the fake Bot API knows, for tests that run side by side. */
export const MORE_AGENCY_BOTS = 8

/**
 * One more agency bot (0 to `MORE_AGENCY_BOTS` - 1): one bot serves one agency only, so tests
 * that run at once, each with an agency of its own, each take another one.
 */
export function moreAgencyBot(n: number): MockBot {
  if (!Number.isInteger(n) || n < 0 || n >= MORE_AGENCY_BOTS)
    throw new Error(`no fake agency bot ${String(n)}`)
  const id = 1000000100 + n
  return {
    token: `${String(id)}:AAmock-more-agency-bot-token-${String(n).padStart(5, '0')}`,
    id,
    username: `agenzia_${String(n)}_mock_bot`,
    firstName: `Agenzia ${String(n)}`,
  }
}

const DEFAULT_BOTS: readonly MockBot[] = [
  ...Object.values(TELEGRAM_MOCK.bots),
  ...Array.from({ length: MORE_AGENCY_BOTS }, (_, n) => moreAgencyBot(n)),
]

/** The fake Bot API with the bots of `TELEGRAM_MOCK` and the others (or its own, for a test). */
export const startTelegramMock = (options: { port?: number; bots?: readonly MockBot[] } = {}) =>
  startWith({ bots: DEFAULT_BOTS, ...options })

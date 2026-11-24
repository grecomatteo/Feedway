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

/** The fake Bot API with the bots of `TELEGRAM_MOCK` (or others, for a test). */
export const startTelegramMock = (options: { port?: number; bots?: readonly MockBot[] } = {}) =>
  startWith({ bots: Object.values(TELEGRAM_MOCK.bots), ...options })

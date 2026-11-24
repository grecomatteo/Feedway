import { startTelegramMock } from './index.ts'

// Development and end-to-end runs (TELEGRAM_API_URL): the fake Bot API on a fixed port.
const port = Number(process.env.TELEGRAM_MOCK_PORT ?? 4020)
const mock = await startTelegramMock({ port })
console.log(`telegram-mock: ${mock.url}`)
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => void mock.stop().then(() => process.exit(0)))

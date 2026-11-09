import { startMetaMock } from './index.ts'

// Development and end-to-end runs (META_MODE=mock): the fake Graph API on a fixed port.
const port = Number(process.env.META_MOCK_PORT ?? 4010)
const mock = await startMetaMock({ port })
console.log(`meta-mock: ${mock.url}`)
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => void mock.stop().then(() => process.exit(0)))

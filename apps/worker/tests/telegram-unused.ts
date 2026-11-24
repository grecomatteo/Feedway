import type { IntegrationStore } from '@app/application'
import type { JobHandlerDeps } from '../src/job-handler.js'

// For the handlers' tests that never reach Telegram: every call fails loudly.

const notUsed = () => Promise.reject(new Error('Telegram is not used here'))

export const UNUSED_TELEGRAM: JobHandlerDeps['telegram'] = {
  api: { getMe: notUsed, getUpdates: notUsed, setMyCommands: notUsed, sendMessage: notUsed },
  integrations: new Proxy({}, { get: () => notUsed }) as IntegrationStore,
  tokens: {
    hash: () => {
      throw new Error('Telegram is not used here')
    },
  },
  lock: { tryRun: notUsed },
  waitSeconds: 0,
}

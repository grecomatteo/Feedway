import { randomBytes } from 'node:crypto'
import { startTestDatabase } from '@app/infrastructure/testing'
import { startWeb } from '../api/helpers.ts'

/** Starts a throwaway database and the production build; the base URL goes to the tests through the environment. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const tdb = await startTestDatabase()
  const web = await startWeb({
    DATABASE_URL: tdb.runtimeUrl,
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    PANEL_URL: 'http://localhost:3000',
    APP_VERSION: '0.0.0-e2e',
  })
  process.env.E2E_BASE_URL = web.url('/')
  return async () => {
    await web.stop()
    await tdb.stop()
  }
}

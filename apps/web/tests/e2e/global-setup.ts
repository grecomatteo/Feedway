import { randomBytes } from 'node:crypto'
import { startTestDatabase } from '@app/infrastructure/testing'
import { startMetaMock } from '@app/meta-mock'
import { freePort, startWeb } from '../api/helpers.ts'

/** Starts a throwaway database and the production build; the base URL goes to the tests through the environment. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const tdb = await startTestDatabase()
  // The browser opens the panel at PANEL_URL itself: signed-in requests are checked against it
  // (origin, cookies). Chromium treats localhost as secure, so the __Host- cookies are kept.
  const port = await freePort()
  const panelUrl = `http://localhost:${String(port)}`
  const encryptionKey = randomBytes(32).toString('base64')
  // no test talks to the real Meta (AGENTS.md): the panel calls the fake Graph API
  const meta = await startMetaMock()
  const web = await startWeb(
    {
      DATABASE_URL: tdb.runtimeUrl,
      APP_ENCRYPTION_KEY: encryptionKey,
      BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
      PANEL_URL: panelUrl,
      APP_VERSION: '0.0.0-e2e',
      META_MODE: 'mock',
      META_MOCK_URL: meta.url,
    },
    { port },
  )
  process.env.E2E_BASE_URL = `${panelUrl}/`
  process.env.E2E_ADMIN_URL = tdb.adminUrl
  process.env.E2E_DATABASE_URL = tdb.runtimeUrl
  // the worker does not run here: tests that need a job run it on these files themselves
  process.env.E2E_MEDIA_ROOT = web.mediaRoot
  // only to sign "Non sono stato io" links as a security email would
  process.env.E2E_ENCRYPTION_KEY = encryptionKey
  return async () => {
    await web.stop()
    await meta.stop()
    await tdb.stop()
  }
}

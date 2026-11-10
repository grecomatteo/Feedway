import type { MetaAppCredentials, PlatformConnector } from '@app/application'
import { MetaError, type MetaErrorReason } from './errors.js'
import type { MetaGraphClient } from './graph-client.js'

// Meta's answer says the credentials are wrong; the others say nothing about them.
const REJECTED: ReadonlySet<MetaErrorReason> = new Set([
  'token_invalid',
  'token_revoked',
  'checkpoint',
  'page_role_missing',
  'permission_missing',
  'not_found_or_forbidden',
  'rejected',
])

/**
 * The app part of the Meta connectors (ADR 019). Meta has no call that only checks App ID and
 * secret: `debug_token` authenticates with the app token `{app-id}|{app-secret}` (in the header),
 * so a wrong pair fails with 190. What it inspects does not matter here: the App ID, which is no
 * secret, so the secret never travels in an address. Not verified on real Meta
 * (docs/platforms/meta.md): tried at the end of plan 03 Task 7.
 */
export function createMetaAppConnector(
  client: Pick<MetaGraphClient, 'debugToken'>,
): Pick<PlatformConnector<MetaAppCredentials>, 'verifyApp'> {
  return {
    async verifyApp(app) {
      try {
        // the answer is about `input_token`, not about the app: only the authentication counts
        await client.debugToken(app, app.appId)
        return { ok: true }
      } catch (error) {
        if (!(error instanceof MetaError)) throw error
        return { ok: false, reason: REJECTED.has(error.reason) ? 'rejected' : 'unavailable' }
      }
    },
  }
}

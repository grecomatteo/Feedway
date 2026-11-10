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
 * secret: `debug_token` on the app token `{app-id}|{app-secret}` authenticates with that same
 * token, so a wrong secret fails with 190, and the answer names the app. Not verified on real
 * Meta (docs/platforms/meta.md): tried at the end of plan 03 Task 7.
 */
export function createMetaAppConnector(
  client: Pick<MetaGraphClient, 'debugToken'>,
): Pick<PlatformConnector<MetaAppCredentials>, 'verifyApp'> {
  return {
    async verifyApp(app) {
      try {
        const { data } = await client.debugToken(app, `${app.appId}|${app.appSecret}`)
        // an answer about another app would mean the App ID is not the one typed
        if (data.appId !== null && data.appId !== app.appId)
          return { ok: false, reason: 'rejected' }
        return { ok: true }
      } catch (error) {
        if (!(error instanceof MetaError)) throw error
        return { ok: false, reason: REJECTED.has(error.reason) ? 'rejected' : 'unavailable' }
      }
    },
  }
}

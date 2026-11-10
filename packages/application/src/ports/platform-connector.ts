/**
 * What a platform gives the product (ADR 019): one connector per connection kind. The app's
 * credentials arrive opaque, as the platform's module defines them; the accounts module never
 * looks inside. This task adds `verifyApp`; the connectors of plan 03 Tasks 6 and 7 add
 * `loadAppCredentials`, the login, the pasted token, the listing and the health check.
 */
export interface PlatformConnector<AppCredentials = unknown> {
  /** Tries the app's credentials with the platform before they are saved. */
  verifyApp(app: AppCredentials): Promise<AppVerification>
}

/**
 * `rejected`: the platform refuses these credentials. `unavailable`: it could not say (down,
 * slow, rate limited): nothing is known about the credentials.
 */
export type AppVerification = { ok: true } | { ok: false; reason: 'rejected' | 'unavailable' }

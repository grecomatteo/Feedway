import type { AuthMethod } from '@app/domain'

/** What the rest of the application knows about a session. No Better Auth type crosses this port. */
export interface AuthSessionInfo {
  id: string
  userId: string
  createdAt: Date
  expiresAt: Date
  updatedAt: Date
  ipAddress: string | null
  userAgent: string | null
  authMethod: AuthMethod
  reauthenticatedAt: Date | null
}

/** A passkey as the Security page shows it; never the key or the credential id. */
export interface PasskeySummary {
  id: string
  /** null when the browser gave no name */
  name: string | null
  createdAt: Date | null
  /** `multiDevice`: synced across the person's devices (a password manager, iCloud…). */
  deviceType: 'singleDevice' | 'multiDevice'
  backedUp: boolean
}

/**
 * Accounts, sessions and the HTTP entry point of the sign-in system. Methods that belong to later
 * tasks (password checks, second factor, reset links) are added with their tasks.
 */
export interface Auth {
  /**
   * Null for a missing, revoked or expired session (12 h idle, or 30 days from creation).
   * `setCookie`: the renewed session cookie when the read extended the session; the caller
   * forwards it, or the browser would drop the cookie 12 hours after the sign-in.
   */
  getSession(
    headers: Headers,
  ): Promise<{ session: AuthSessionInfo; userId: string; setCookie: string[] } | null>
  /** Only for the catch-all route `/api/auth/[...all]`. */
  handler(request: Request): Promise<Response>
  listSessions(userId: string): Promise<AuthSessionInfo[]>
  revokeSession(userId: string, sessionId: string): Promise<boolean>
  revokeAllSessions(userId: string, opts?: { exceptSessionId?: string }): Promise<number>
  /** False for a wrong password and for an account without one: the caller cannot tell. */
  verifyPassword(userId: string, password: string): Promise<boolean>
  /**
   * The account an activation creates, with our id (ADR 012, V2). If a user with this id already
   * exists (an interrupted activation), only its password is replaced, and only when given.
   * `password: null` creates no password: the person registers a passkey next.
   */
  createUser(input: {
    id: string
    email: string
    name: string
    password: string | null
  }): Promise<void>
  /** A session opened by us, with the same cookie as a real sign-in (ADR 012, V8). */
  openSession(
    userId: string,
    meta: { ip: string | null; userAgent: string | null; authMethod: 'activation' },
  ): Promise<{ setCookie: string[] }>
  /**
   * A password reset link to copy from the panel (Better Auth token, one hour), sent nowhere.
   * Null when no account has this email.
   */
  passwordResetUrl(email: string): Promise<string | null>
  /** The factors a person holds: TOTP on or off, and their passkeys, oldest first. */
  secondFactorStatus(userId: string): Promise<{ totpEnabled: boolean; passkeys: PasskeySummary[] }>
}

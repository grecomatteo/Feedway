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

/**
 * Accounts, sessions and the HTTP entry point of the sign-in system. Methods that belong to later
 * tasks (account creation, password checks, second factor, reset links) are added with their tasks.
 */
export interface Auth {
  /** Null for a missing, revoked or expired session (12 h idle, or 30 days from creation). */
  getSession(headers: Headers): Promise<{ session: AuthSessionInfo; userId: string } | null>
  /** Only for the catch-all route `/api/auth/[...all]`. */
  handler(request: Request): Promise<Response>
  listSessions(userId: string): Promise<AuthSessionInfo[]>
  revokeSession(userId: string, sessionId: string): Promise<boolean>
  revokeAllSessions(userId: string, opts?: { exceptSessionId?: string }): Promise<number>
}

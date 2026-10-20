import type { AuthSessionInfo } from '@app/application'
import type { AuthMethod } from '@app/domain'
import { AUTH_METHODS, type sessions } from '../db/identity/schema.js'

/** The `sessions.auth_method` column, checked: a value we do not know is a bug, not a guess. */
export function toAuthMethod(value: unknown): AuthMethod {
  const found = AUTH_METHODS.find((method) => method === value)
  if (!found) throw new Error(`Metodo di accesso sconosciuto: ${String(value)}`)
  return found
}

/** A `sessions` row as the rest of the application knows it. */
export function toSessionInfo(row: typeof sessions.$inferSelect): AuthSessionInfo {
  return {
    id: row.id,
    userId: row.userId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    updatedAt: row.updatedAt,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    authMethod: toAuthMethod(row.authMethod),
    reauthenticatedAt: row.reauthenticatedAt,
  }
}

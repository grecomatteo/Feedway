import type { AuthMethod } from '@app/domain'
import { AUTH_METHODS } from '../db/identity/schema.js'

/** The `sessions.auth_method` column, checked: a value we do not know is a bug, not a guess. */
export function toAuthMethod(value: unknown): AuthMethod {
  const found = AUTH_METHODS.find((method) => method === value)
  if (!found) throw new Error(`Metodo di accesso sconosciuto: ${String(value)}`)
  return found
}

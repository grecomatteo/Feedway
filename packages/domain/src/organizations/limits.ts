export type LimitKey =
  'workspaces' | 'social_accounts' | 'users' | 'storage_bytes' | 'posts_per_day'

export const LIMIT_KEYS: readonly LimitKey[] = [
  'workspaces',
  'social_accounts',
  'users',
  'storage_bytes',
  'posts_per_day',
]

export type OrganizationLimits = Partial<Record<LimitKey, number>>

export type LimitCheck = { ok: true } | { ok: false; limit: number }

/**
 * The limits stored on an agency (`organizations.limits`). A key that is present but not a
 * whole non-negative number counts as 0: a broken value closes, it never lifts the limit.
 */
export function parseLimits(raw: Record<string, unknown>): OrganizationLimits {
  const known: readonly string[] = LIMIT_KEYS
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([key]) => known.includes(key))
      .map(([key, value]) => [
        key,
        typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0,
      ]),
  )
}

// A missing key means unlimited.
export function checkLimit(
  limits: OrganizationLimits,
  key: LimitKey,
  currentUsage: number,
  adding = 1,
): LimitCheck {
  const limit = limits[key]
  if (limit === undefined) return { ok: true }
  return currentUsage + adding <= limit ? { ok: true } : { ok: false, limit }
}

/**
 * Limits as the platform sets them: every key known, every value a whole non-negative number.
 * Null otherwise: a wrong value is refused, never stored to be read as 0 later.
 */
export function validLimits(raw: Record<string, unknown>): OrganizationLimits | null {
  const known: readonly string[] = LIMIT_KEYS
  for (const [key, value] of Object.entries(raw)) {
    if (!known.includes(key)) return null
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null
  }
  return parseLimits(raw)
}

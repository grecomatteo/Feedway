export type LimitKey =
  'workspaces' | 'social_accounts' | 'users' | 'storage_bytes' | 'posts_per_day'

export type OrganizationLimits = Partial<Record<LimitKey, number>>

export type LimitCheck = { ok: true } | { ok: false; limit: number }

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

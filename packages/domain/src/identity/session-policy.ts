export const SESSION_IDLE_MS = 12 * 3600_000
export const SESSION_ABSOLUTE_MS = 30 * 86_400_000
export const REAUTH_WINDOW_MS = 10 * 60_000

export function isBeyondAbsoluteLifetime(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() >= SESSION_ABSOLUTE_MS
}

export function hasRecentReauth(reauthenticatedAt: Date | null, now: Date): boolean {
  return (
    reauthenticatedAt !== null && now.getTime() - reauthenticatedAt.getTime() < REAUTH_WINDOW_MS
  )
}

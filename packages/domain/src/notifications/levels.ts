/** How much a notification matters, lowest first (§12.2). */
export const LEVELS = ['info', 'success', 'warning', 'error', 'critical', 'security'] as const
export type Level = (typeof LEVELS)[number]

export function atLeast(level: Level, min: Level): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(min)
}

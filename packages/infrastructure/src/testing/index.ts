import type { Clock } from '@app/application'

export { startTestDatabase } from './test-database.js'
export type { TestDatabase } from './test-database.js'

export function fixedClock(at: Date): Clock & { advance(ms: number): void } {
  let current = at.getTime()
  return {
    now: () => new Date(current),
    advance(ms) {
      current += ms
    },
  }
}

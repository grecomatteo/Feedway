import type { Clock } from '@app/application'

export { startTestDatabase } from './test-database.js'
export type { TestDatabase } from './test-database.js'
export { startContractServer, CONTRACT_PASSWORD } from '../auth/contract/serve.js'
export type { ContractServer } from '../auth/contract/serve.js'

export function fixedClock(at: Date): Clock & { advance(ms: number): void } {
  let current = at.getTime()
  return {
    now: () => new Date(current),
    advance(ms) {
      current += ms
    },
  }
}
export { withScope } from './scoped-db.js'
export type { Scope } from './scoped-db.js'
export { seed } from './seed.js'
export type { Seeder } from './seed.js'
export { waitForLockWaiter } from './locks.js'

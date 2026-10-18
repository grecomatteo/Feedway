import type { Tx } from './tx.js'

/** With only `userId`: personal data and the agency switcher, no agency rows. */
export type TxScope = { organizationId: string; userId: string } | { userId: string }

export interface UnitOfWork {
  /** One transaction whose row level security sees only `scope`. */
  run<T>(scope: TxScope, fn: (tx: Tx) => Promise<T>): Promise<T>
  /**
   * One transaction that sees every agency. Allowed only in the modules listed by the ESLint
   * rule on `runAsSystem`; `reason` is logged at info level.
   */
  runAsSystem<T>(reason: string, fn: (tx: Tx) => Promise<T>): Promise<T>
}

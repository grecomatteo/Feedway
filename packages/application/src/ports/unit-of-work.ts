import type { Tx } from './tx.js'

/**
 * With only `userId`: personal data and the agency switcher, no agency rows. With `userId: null`:
 * a job of the agency (plan §4), which acts for no person and sees nothing personal.
 */
export type TxScope =
  | { organizationId: string; userId: string }
  | { userId: string }
  | { organizationId: string; userId: null }

export interface SystemScopeOptions {
  /**
   * A reason that comes back every minute or at every send (the beat, the polls, the
   * dispatcher's runs): logged at debug level, so the rare ones stay readable at info.
   */
  routine?: boolean
}

export interface UnitOfWork {
  /** One transaction whose row level security sees only `scope`. */
  run<T>(scope: TxScope, fn: (tx: Tx) => Promise<T>): Promise<T>
  /**
   * One transaction that sees every agency. Allowed only in the modules listed by the ESLint
   * rule on `runAsSystem`; `reason` is logged at info level, at debug for a routine one.
   */
  runAsSystem<T>(reason: string, fn: (tx: Tx) => Promise<T>, opts?: SystemScopeOptions): Promise<T>
}

/**
 * The database could not finish the transaction for a reason that passes on its own: no
 * connection free in time, a connection lost, Postgres restarting, a serialization failure or a
 * deadlock. Nothing of the transaction was saved; the same work may simply be tried again. The
 * unit of work throws it in place of the driver's error, which stays as `cause`.
 */
export class StoreUnavailableError extends Error {
  override readonly name = 'StoreUnavailableError'
  constructor(options: { cause: unknown }) {
    super('database temporarily unavailable', options)
  }
}

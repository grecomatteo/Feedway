import type { TargetStatus } from './target-status.js'

/** Who moves a destination: a person through a route, or a job of the worker. */
export type TargetMover = 'panel' | 'worker'

type Moves = ReadonlyMap<TargetStatus, readonly TargetStatus[]>

// §9.3 split by who makes each move. The panel never moves a destination into the steps of the
// worker and never touches one that is publishing (P2); the worker never schedules, cancels or
// brings back to draft. Staying in the same state (a new look at a container, a second round
// of verification) is not a move.
const PANEL: Moves = new Map<TargetStatus, TargetStatus[]>([
  ['draft', ['scheduled']],
  // P2: editing brings the destination back to `scheduled`, and what is ready on Meta is dropped
  ['scheduled', ['draft', 'cancelled']],
  ['preparing', ['scheduled', 'draft', 'cancelled']],
  ['ready', ['scheduled', 'draft', 'cancelled']],
  ['retrying', ['scheduled', 'draft', 'cancelled']],
  // «Riprova» starts again from the failed step
  ['failed', ['scheduled', 'cancelled']],
  // P5: «Riprendi» or «Annulla»
  ['paused', ['scheduled', 'cancelled']],
  // the post may exist on Meta: «Riprova» asks Meta first (`unknown`, Task 8), and a person
  // who saw it on the profile marks it as verified
  ['problem', ['unknown', 'confirmed']],
])

const WORKER: Moves = new Map<TargetStatus, TargetStatus[]>([
  // `failed` here and from `ready`: too late to start (D-77 b)
  ['scheduled', ['preparing', 'failed', 'paused']],
  ['preparing', ['ready', 'retrying', 'failed', 'paused']],
  // back to `preparing`: an Instagram container expired and is made again (§9.5)
  ['ready', ['publishing', 'preparing', 'failed', 'paused']],
  ['publishing', ['published', 'retrying', 'failed', 'unknown']],
  ['retrying', ['preparing', 'publishing', 'paused']],
  // found, not found after the searches, or not on Meta after a «Riprova» from `problem`
  ['unknown', ['published', 'retrying', 'failed']],
  ['published', ['verifying']],
  ['verifying', ['confirmed', 'problem']],
])

export function canMoveTarget(from: TargetStatus, to: TargetStatus, by: TargetMover): boolean {
  return (by === 'panel' ? PANEL : WORKER).get(from)?.includes(to) ?? false
}

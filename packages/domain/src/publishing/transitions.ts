import type { TargetStatus } from './target-status.js'

/** Who moves a destination: a person through a route, or a job of the worker. */
export type TargetMover = 'panel' | 'worker'

type Moves = ReadonlyMap<TargetStatus, readonly TargetStatus[]>

// §9.3 split by who makes each move. The panel never moves a destination into the steps of the
// worker, except «Riprova» from `problem` (to `unknown`), and never touches one that is
// publishing (P2); the worker never schedules or brings back to draft, and cancels only what
// has not started publishing, of a client archived meanwhile (D-70). Staying in the same state (a new look at a container, a second round
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
  ['scheduled', ['preparing', 'failed', 'paused', 'cancelled']],
  ['preparing', ['ready', 'retrying', 'failed', 'paused', 'cancelled']],
  // back to `preparing`: an Instagram container expired and is made again (§9.5)
  // `retrying`: a short call before publishing (the Page token) failed for a while
  ['ready', ['publishing', 'preparing', 'retrying', 'failed', 'paused', 'cancelled']],
  ['publishing', ['published', 'retrying', 'failed', 'unknown']],
  // `failed`: the checks before the step find a permanent problem (copies, token, rules)
  ['retrying', ['preparing', 'publishing', 'failed', 'paused', 'cancelled']],
  // found after an uncertain call (`published`, then verified) or after a «Riprova» from
  // `problem` (`confirmed`, it was already verified once); not found after the searches
  // (`failed`), or not on Meta after a «Riprova» from `problem` (`retrying`, republish)
  ['unknown', ['published', 'confirmed', 'retrying', 'failed']],
  ['published', ['verifying']],
  ['verifying', ['confirmed', 'problem']],
])

export function canMoveTarget(from: TargetStatus, to: TargetStatus, by: TargetMover): boolean {
  return (by === 'panel' ? PANEL : WORKER).get(from)?.includes(to) ?? false
}

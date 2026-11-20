// The states of a destination (spec §9.3; plan 07, Task 2). The use cases, the repository and
// the jobs live in the `posts` module (P1): this folder holds the pure rules only.

export const TARGET_STATUSES = [
  'draft',
  'scheduled',
  'preparing',
  'ready',
  'publishing',
  'retrying',
  'unknown',
  'published',
  'verifying',
  'confirmed',
  'problem',
  'failed',
  'paused',
  'cancelled',
] as const
export type TargetStatus = (typeof TARGET_STATUSES)[number]

/**
 * The step a destination is at (`post_targets.step`), for the job keys and for what a state
 * means: `unknown` after `publish` is an uncertain publishing call (not found → `failed`),
 * `unknown` after `recheck` is a «Riprova» from `problem` (not found → `retrying`, Task 8).
 */
export const TARGET_STEPS = ['prepare', 'publish', 'verify', 'recheck'] as const
export type TargetStep = (typeof TARGET_STEPS)[number]

/**
 * How one call of a step ended (`target_attempts.outcome`): `done`, `wait` (a container still
 * being processed), or the kind of the error (`PublishError`, Task 4).
 */
export const ATTEMPT_OUTCOMES = ['done', 'wait', 'transient', 'permanent', 'uncertain'] as const
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number]

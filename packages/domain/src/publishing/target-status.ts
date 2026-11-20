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

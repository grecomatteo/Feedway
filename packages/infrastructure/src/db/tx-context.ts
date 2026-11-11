/** The scope a transaction was opened with, handed to repositories that need it as a barrier. */
export type TxContext =
  | { kind: 'system' }
  | { kind: 'user'; userId: string }
  /** `userId` null: a job of the agency, acting for no person. */
  | { kind: 'organization'; organizationId: string; userId: string | null }

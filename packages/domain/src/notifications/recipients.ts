/**
 * Who a kind of notification is for (§10.2, plan 08 Scelta 4). `scheduler` is
 * `posts.scheduled_by`, as for the pause (plan 07, P6). `workspace_preparers` is who may prepare
 * the client's plan (`plan.prepare`): its members with a role that grants it, and the agency's
 * Owner and Admin (plan 09 Task 8).
 */
export const RECIPIENT_RULES = [
  'scheduler',
  'workspace_managers',
  'workspace_preparers',
  'org_admins',
  'platform_admins',
] as const
export type RecipientRule = (typeof RECIPIENT_RULES)[number]

/** The candidates the dispatcher found for one event, before it drops who can no longer see. */
export interface RecipientFacts {
  schedulers: readonly string[]
  workspaceManagers: readonly string[]
  /** Who has `plan.prepare` in the client, Owner and Admin of the agency included */
  workspacePreparers: readonly string[]
  /** Owner and Admin of the agency */
  orgAdmins: readonly string[]
  platformAdmins: readonly string[]
}

/** One person, with every rule that picked them: one notification each (Scelta 4). */
export interface Recipient {
  userId: string
  as: readonly RecipientRule[]
}

const FACT_OF: Record<RecipientRule, keyof RecipientFacts> = {
  scheduler: 'schedulers',
  workspace_managers: 'workspaceManagers',
  workspace_preparers: 'workspacePreparers',
  org_admins: 'orgAdmins',
  platform_admins: 'platformAdmins',
}

export function recipientsFor(rules: readonly RecipientRule[], facts: RecipientFacts): Recipient[] {
  const byUser = new Map<string, RecipientRule[]>()
  for (const rule of rules)
    for (const userId of facts[FACT_OF[rule]]) {
      const as = byUser.get(userId)
      if (!as) byUser.set(userId, [rule])
      else if (!as.includes(rule)) as.push(rule)
    }
  return [...byUser].map(([userId, as]) => ({ userId, as }))
}

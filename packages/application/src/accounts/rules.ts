import type { RuleAccount } from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { Tx } from '../ports/tx.js'

/**
 * The accounts assigned to the workspace as the checks before scheduling read them (plan 05),
 * in one query. An account not assigned to it, of another agency, or an id that is not one is
 * left out: for the rules it is «not available in this client», whoever owns it.
 */
export async function getAccountsForRules(
  tx: Tx,
  scope: { organizationId: string; workspaceId: string },
  accountIds: readonly string[],
): Promise<Map<string, RuleAccount>> {
  const wanted = new Set(accountIds.filter(isUuid))
  if (wanted.size === 0) return new Map()
  const records = await tx.accounts.list(scope.organizationId, {
    workspaceIds: [scope.workspaceId],
  })
  // the permissions are the connection's: the cover of a Facebook reel reads them (D-120.9)
  const scopes = new Map(
    (await tx.connections.list(scope.organizationId)).map((c) => [c.id, c.scopes] as const),
  )
  return new Map(
    records
      .filter((r) => wanted.has(r.id))
      .map((r) => [
        r.id,
        {
          platform: r.platform,
          active: r.active,
          health: r.health,
          inWorkspace: true,
          scopes: scopes.get(r.connectionId) ?? null,
          quota:
            r.quotaUsed === null || r.quotaTotal === null || r.quotaCheckedAt === null
              ? null
              : { used: r.quotaUsed, total: r.quotaTotal, checkedAt: r.quotaCheckedAt },
        },
      ]),
  )
}

import {
  can,
  recipientsFor,
  type OrgActor,
  type Recipient,
  type RecipientFacts,
  type RecipientRule,
} from '@app/domain'
import type { PendingOutboxEvent } from '../ports/publishing.js'
import type { UserRecord } from '../ports/repositories.js'
import type { Tx } from '../ports/tx.js'
import { asString } from './message.js'

// Who gets one event (§12.1 punto 2, §10.2, plan 08 Scelta 4): the candidates of the kind's
// rules, then only those who can still see it now. Read in the dispatcher's transaction.

/** `account.quota_low`: who scheduled posts on the account in the next 24 hours. */
const QUOTA_HORIZON_MS = 24 * 3_600_000

const ADMIN_ROLES = new Set(['owner', 'admin'])

interface EventPlace {
  organizationId: string | null
  /** The client the event is about; null for the agency's or the platform's */
  workspaceId: string | null
}

export const placeOfEvent = (event: PendingOutboxEvent): EventPlace => ({
  organizationId: event.organizationId,
  workspaceId: asString(event.payload.workspaceId),
})

/** The clients the event's account is assigned to (`account.quota_low` carries only its id). */
async function accountWorkspaces(tx: Tx, organizationId: string, event: PendingOutboxEvent) {
  const accountId = asString(event.payload.accountId)
  if (accountId === null) return []
  const rows = await tx.workspaceAccounts.listForAccounts(organizationId, [accountId])
  return [...new Set(rows.map((r) => r.workspaceId))]
}

async function schedulersOf(
  tx: Tx,
  organizationId: string,
  event: PendingOutboxEvent,
  now: Date,
): Promise<string[]> {
  const workspaceId = asString(event.payload.workspaceId)
  const postId = asString(event.payload.postId)
  if (postId !== null && workspaceId !== null) {
    const post = await tx.posts.find({ organizationId, workspaceId }, postId)
    return post?.scheduledBy ? [post.scheduledBy] : []
  }
  const accountId = asString(event.payload.accountId)
  if (event.type !== 'account.quota_low' || accountId === null) return []
  const workspaces = await accountWorkspaces(tx, organizationId, event)
  if (workspaces.length === 0) return []
  const targets = await tx.posts.scheduledTargets(organizationId, workspaces, [accountId], now)
  const until = now.getTime() + QUOTA_HORIZON_MS
  const found = new Set<string>()
  for (const { postId: id, workspaceId: ws } of targets) {
    const post = await tx.posts.find({ organizationId, workspaceId: ws }, id)
    if (post?.scheduledBy && post.scheduledAt && post.scheduledAt.getTime() <= until)
      found.add(post.scheduledBy)
  }
  return [...found]
}

async function managersOf(tx: Tx, organizationId: string, event: PendingOutboxEvent) {
  const workspaceId = asString(event.payload.workspaceId)
  const workspaces =
    workspaceId !== null ? [workspaceId] : await accountWorkspaces(tx, organizationId, event)
  const found = new Set<string>()
  for (const ws of workspaces)
    for (const m of await tx.workspaceMembers.listForWorkspace(organizationId, ws))
      if (m.role === 'manager') found.add(m.userId)
  return [...found]
}

/** The candidates of the kind's rules, read only where a rule needs them. */
export async function candidatesOf(
  tx: Tx,
  event: PendingOutboxEvent,
  rules: readonly RecipientRule[],
  now: Date,
): Promise<Recipient[]> {
  const facts: RecipientFacts = {
    schedulers: [],
    workspaceManagers: [],
    orgAdmins: [],
    platformAdmins: [],
  }
  const org = event.organizationId
  if (org !== null) {
    if (rules.includes('scheduler')) facts.schedulers = await schedulersOf(tx, org, event, now)
    if (rules.includes('workspace_managers'))
      facts.workspaceManagers = await managersOf(tx, org, event)
    if (rules.includes('org_admins'))
      facts.orgAdmins = (await tx.orgMembers.listForOrganization(org))
        .filter((m) => m.status === 'active' && ADMIN_ROLES.has(m.role))
        .map((m) => m.userId)
  } else if (rules.includes('platform_admins'))
    facts.platformAdmins = (await tx.users.listActivePlatformAdmins()).map((u) => u.id)
  return recipientsFor(rules, facts)
}

/**
 * The person as they are now, if they may still see the event: active, not anonymized, an
 * active member of the agency who sees the client, or still a platform administrator. Read again
 * by the delivery, so a Manager taken off the client meanwhile gets nothing (Review Focus 3).
 */
export async function eligibleUser(
  tx: Tx,
  userId: string,
  place: EventPlace,
): Promise<UserRecord | null> {
  const user = await tx.users.findById(userId)
  if (user?.status !== 'active' || user.anonymizedAt !== null) return null
  const { organizationId, workspaceId } = place
  if (organizationId === null) return user.platformRole === 'admin' ? user : null
  const membership = await tx.orgMembers.find(organizationId, userId)
  if (membership?.status !== 'active') return null
  if (workspaceId === null) return user
  const actor: OrgActor = {
    userId,
    platformRole: null,
    organizationId,
    orgRole: membership.role,
    memberships: await tx.workspaceMembers.rolesOf(organizationId, userId),
  }
  return can(actor, 'workspace.view', { organizationId, workspaceId }) ? user : null
}

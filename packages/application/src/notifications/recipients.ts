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

export interface EventPlace {
  organizationId: string | null
  /** The client the event is about; null for the agency's or the platform's */
  workspaceId: string | null
  /** The account of an event with no client (`account.quota_low`): seen through its clients */
  accountId: string | null
}

export const placeOf = (
  organizationId: string | null,
  payload: Readonly<Record<string, unknown>>,
): EventPlace => ({
  organizationId,
  workspaceId: asString(payload.workspaceId),
  accountId: asString(payload.accountId),
})

export const placeOfEvent = (event: PendingOutboxEvent): EventPlace =>
  placeOf(event.organizationId, event.payload)

/** The clients the event's account is assigned to (`account.quota_low` carries only its id). */
async function workspacesOfAccount(tx: Tx, organizationId: string, accountId: string | null) {
  if (accountId === null) return []
  const rows = await tx.workspaceAccounts.listForAccounts(organizationId, [accountId])
  return [...new Set(rows.map((r) => r.workspaceId))]
}

/**
 * The rows `eligibleUser` reads, remembered for one transaction (R9 of the tappa 8 review): a
 * group of 30 deliveries, a page of the centre or a batch of the outbox asks about the same
 * person, agency and account again and again, and reads them once. Keyed by the `Tx`, which
 * lives as long as its transaction: the next one reads everything again. Nothing that uses it
 * writes these rows in the same transaction.
 */
interface EligibilityReads {
  user(userId: string): Promise<UserRecord | null>
  membership(organizationId: string, userId: string): ReturnType<Tx['orgMembers']['find']>
  roles(organizationId: string, userId: string): ReturnType<Tx['workspaceMembers']['rolesOf']>
  accountWorkspaces(organizationId: string, accountId: string | null): Promise<string[]>
}

const READS = new WeakMap<Tx, EligibilityReads>()

function remembered<T>(memo: Map<string, Promise<T>>, key: string, read: () => Promise<T>) {
  let found = memo.get(key)
  if (!found) {
    found = read()
    // a read that failed is not remembered: the transaction fails with it anyway
    void found.catch(() => memo.delete(key))
    memo.set(key, found)
  }
  return found
}

function readsOf(tx: Tx): EligibilityReads {
  const known = READS.get(tx)
  if (known) return known
  const users = new Map<string, Promise<UserRecord | null>>()
  const memberships = new Map<string, ReturnType<Tx['orgMembers']['find']>>()
  const roles = new Map<string, ReturnType<Tx['workspaceMembers']['rolesOf']>>()
  const accounts = new Map<string, Promise<string[]>>()
  const reads: EligibilityReads = {
    user: (userId) => remembered(users, userId, () => tx.users.findById(userId)),
    membership: (organizationId, userId) =>
      remembered(memberships, `${organizationId}:${userId}`, () =>
        tx.orgMembers.find(organizationId, userId),
      ),
    roles: (organizationId, userId) =>
      remembered(roles, `${organizationId}:${userId}`, () =>
        tx.workspaceMembers.rolesOf(organizationId, userId),
      ),
    accountWorkspaces: (organizationId, accountId) =>
      accountId === null
        ? Promise.resolve([])
        : remembered(accounts, `${organizationId}:${accountId}`, () =>
            workspacesOfAccount(tx, organizationId, accountId),
          ),
  }
  READS.set(tx, reads)
  return reads
}

const accountWorkspaces = (tx: Tx, organizationId: string, event: PendingOutboxEvent) =>
  workspacesOfAccount(tx, organizationId, asString(event.payload.accountId))

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

/**
 * Who may prepare the client's plan (`plan.prepare`, plan 09 Task 8): its members with a role
 * that grants it, and the agency's Owner and Admin, who see every client.
 */
async function preparersOf(tx: Tx, organizationId: string, event: PendingOutboxEvent) {
  const workspaceId = asString(event.payload.workspaceId)
  if (workspaceId === null) return []
  const scope = { organizationId, workspaceId }
  const found = new Set<string>()
  for (const m of await tx.workspaceMembers.listForWorkspace(organizationId, workspaceId)) {
    const actor: OrgActor = {
      userId: m.userId,
      platformRole: null,
      organizationId,
      orgRole: 'member',
      memberships: new Map([[workspaceId, m.role]]),
    }
    if (can(actor, 'plan.prepare', scope)) found.add(m.userId)
  }
  for (const m of await tx.orgMembers.listForOrganization(organizationId))
    if (m.status === 'active' && ADMIN_ROLES.has(m.role)) found.add(m.userId)
  return [...found]
}

/** Who started the import in bulk of the event (plan 09 Task 10). */
async function initiatorsOf(tx: Tx, organizationId: string, event: PendingOutboxEvent) {
  const workspaceId = asString(event.payload.workspaceId)
  const id = asString(event.payload.bulkImportId)
  if (workspaceId === null || id === null) return []
  const record = await tx.bulkImports.find({ organizationId, workspaceId }, id)
  return record ? [record.createdBy] : []
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
    workspacePreparers: [],
    initiators: [],
    orgAdmins: [],
    platformAdmins: [],
  }
  const org = event.organizationId
  if (org !== null) {
    if (rules.includes('scheduler')) facts.schedulers = await schedulersOf(tx, org, event, now)
    if (rules.includes('workspace_managers'))
      facts.workspaceManagers = await managersOf(tx, org, event)
    if (rules.includes('workspace_preparers'))
      facts.workspacePreparers = await preparersOf(tx, org, event)
    if (rules.includes('initiator')) facts.initiators = await initiatorsOf(tx, org, event)
    if (rules.includes('org_admins'))
      facts.orgAdmins = (await tx.orgMembers.listForOrganization(org))
        .filter((m) => m.status === 'active' && ADMIN_ROLES.has(m.role))
        .map((m) => m.userId)
  } else if (rules.includes('platform_admins'))
    facts.platformAdmins = (await tx.users.listActivePlatformAdmins()).map((u) => u.id)
  return recipientsFor(rules, facts)
}

/** A kind that reaches only the agency's Owner and Admin: a demoted one no longer gets it. */
const onlyAdmins = (rules: readonly RecipientRule[]) =>
  rules.length > 0 && rules.every((r) => r === 'org_admins')

/**
 * What the person must still be allowed in the client: to prepare its plan for a kind only for
 * who prepares (an Editor made Viewer gets nothing, plan 09 Task 8), to see it otherwise.
 */
const neededIn = (rules: readonly RecipientRule[]) =>
  rules.length > 0 && rules.every((r) => r === 'workspace_preparers')
    ? 'plan.prepare'
    : 'workspace.view'

/**
 * The person as they are now, if they may still see the event: active, not anonymized, an
 * active member of the agency who sees the client (or one client of the account), may still
 * prepare its plan for a kind of who prepares, still an Owner or Admin for a kind of theirs, or
 * still a platform administrator. Read again by the
 * delivery, so a Manager taken off the client meanwhile gets nothing (Review Focus 3). Within
 * one transaction each row is read once (`readsOf`).
 */
export async function eligibleUser(
  tx: Tx,
  userId: string,
  place: EventPlace,
  rules: readonly RecipientRule[],
): Promise<UserRecord | null> {
  const reads = readsOf(tx)
  const user = await reads.user(userId)
  if (user?.status !== 'active' || user.anonymizedAt !== null) return null
  const { organizationId, workspaceId, accountId } = place
  if (organizationId === null) return user.platformRole === 'admin' ? user : null
  const membership = await reads.membership(organizationId, userId)
  if (membership?.status !== 'active') return null
  if (onlyAdmins(rules)) return ADMIN_ROLES.has(membership.role) ? user : null
  if (workspaceId === null && accountId === null) return user
  const workspaces =
    workspaceId !== null ? [workspaceId] : await reads.accountWorkspaces(organizationId, accountId)
  const actor: OrgActor = {
    userId,
    platformRole: null,
    organizationId,
    orgRole: membership.role,
    memberships: await reads.roles(organizationId, userId),
  }
  const need = neededIn(rules)
  return workspaces.some((ws) => can(actor, need, { organizationId, workspaceId: ws }))
    ? user
    : null
}

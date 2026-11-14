import { can, DomainError, profilesWithoutClient, proposedName, type OrgActor } from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { Clock } from '../ports/clock.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import {
  assertActiveOrganization,
  cannotManage,
  currentActor,
  lockVisibleWorkspace,
  managesWorkspaces,
  recordAssignment,
  recordWorkspace,
} from '../workspaces/index.js'
import type { ClientImportUndo } from './connections.js'
import type { ClientProfile } from './workspace-accounts.js'

// Clients born from their profiles (spec §14.7, plan 04 Task 5c): «Sistemali» and the «Annulla»
// of «Crea N clienti». The import itself is in connections.ts, the new client in workspaces.

/** A profile in no client, with the name its client would take. */
export interface ProfileWithoutClient {
  key: string
  name: string
  accounts: (ClientProfile['accounts'][number] & { externalId: string })[]
}

/** At most this many workspaces or assignments in one «Annulla»: one import's worth. */
const MAX_UNDO = 100

const cannotAssign = () =>
  new DomainError('FORBIDDEN', 'Solo Owner e Admin possono assegnare gli account agli spazi')

/**
 * «Sistemali»: the profiles of the agency's active accounts that are in no client, for those who
 * can assign accounts (Owner and Admin, who see every workspace).
 */
export async function listProfilesWithoutClient(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
): Promise<ProfileWithoutClient[]> {
  const { organizationId } = actor
  if (!can(actor, 'workspace.accounts.assign', { organizationId })) throw cannotAssign()
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const current = await currentActor(tx, actor)
    if (!can(current, 'workspace.accounts.assign', { organizationId })) throw cannotAssign()
    const accounts = await tx.accounts.list(organizationId, {})
    const assigned = new Set(
      (
        await tx.workspaceAccounts.listForAccounts(
          organizationId,
          accounts.map((a) => a.id),
        )
      ).map((a) => a.accountId),
    )
    return profilesWithoutClient(accounts, assigned).map((p) => ({
      key: p.key,
      name: proposedName(p.accounts),
      accounts: p.accounts.map((a) => ({
        id: a.id,
        externalId: a.externalId,
        platform: a.platform,
        name: a.name,
        username: a.username,
        avatarKey: a.avatarKey,
      })),
    }))
  })
}

/** «Annulla» works for this long after the import, and only for the person who made it. */
export const UNDO_WINDOW_MS = 15 * 60 * 1000

const undoExpired = () =>
  new DomainError(
    'CONFLICT',
    'Non si può più annullare questa importazione: sistema i clienti dalla pagina Clienti',
  )

/**
 * Whether the newest `action` on this entity of the workspace, since `since`, is the actor's: what
 * «Annulla» takes back must be what the same person did moments ago, as the activity log says,
 * not whatever the browser names.
 */
async function lastDoneBy(
  tx: Tx,
  q: { organizationId: string; workspaceId: string; entityId: string; actorId: string },
  action: 'workspace.created' | 'account.assigned',
  since: Date,
): Promise<boolean> {
  const entries = await tx.audit.listForOrganization({
    organizationId: q.organizationId,
    workspaceId: q.workspaceId,
    action,
    from: since,
    limit: MAX_UNDO,
  })
  const newest = entries.find((e) => e.entityId === q.entityId)
  return newest?.actorId === q.actorId
}

/**
 * «Annulla» after «Crea N clienti» (spec §14.7): the assignments that import made are undone and
 * the clients it created are archived. Only for the person who imported, within
 * `UNDO_WINDOW_MS`, and only what the activity log shows as theirs: an account someone else put
 * into one of those clients meanwhile stays, and a client with people working in it refuses.
 * The accounts stay imported and go back to «Sistemali». A repeat changes nothing.
 */
export async function undoClientImport(
  deps: { uow: UnitOfWork; clock: Clock },
  actor: OrgActor,
  input: ClientImportUndo,
  request: { ip: string | null },
): Promise<void> {
  const { organizationId } = actor
  const workspaceIds = [...new Set(input.workspaceIds)]
  if (workspaceIds.length > MAX_UNDO || input.assignments.length > MAX_UNDO)
    throw new DomainError('VALIDATION', 'Valore non valido', { field: 'workspaceIds' })
  const mayUndo = (a: OrgActor) =>
    can(a, 'workspace.accounts.assign', { organizationId }) &&
    (workspaceIds.length === 0 || managesWorkspaces(a))
  if (!can(actor, 'workspace.accounts.assign', { organizationId })) throw cannotAssign()
  if (!mayUndo(actor)) throw cannotManage()
  const since = new Date(deps.clock.now().getTime() - UNDO_WINDOW_MS)
  await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const fresh = await currentActor(tx, actor)
    if (!mayUndo(fresh)) throw cannotAssign()
    await assertActiveOrganization(tx, organizationId)
    const touched = [
      ...new Set([...workspaceIds, ...input.assignments.map((a) => a.workspaceId)]),
    ].sort()
    const locked = new Map<string, { archived: boolean }>()
    for (const id of touched) {
      const { workspace } = await lockVisibleWorkspace(tx, fresh, id)
      locked.set(id, { archived: workspace.archivedAt !== null })
    }
    for (const { accountId } of input.assignments)
      if (!isUuid(accountId) || (await tx.accounts.findById(organizationId, accountId)) === null)
        throw new DomainError('NOT_FOUND', 'Account non trovato')
    const mine = (
      workspaceId: string,
      entityId: string,
      action: Parameters<typeof lastDoneBy>[2],
    ) =>
      lastDoneBy(
        tx,
        { organizationId, workspaceId, entityId, actorId: fresh.userId },
        action,
        since,
      )
    for (const id of workspaceIds) {
      if (locked.get(id)?.archived) continue
      if (!(await mine(id, id, 'workspace.created'))) throw undoExpired()
      if ((await tx.workspaceMembers.listForWorkspace(organizationId, id)).length > 0)
        throw new DomainError(
          'CONFLICT',
          'Qualcuno lavora già in uno dei clienti creati: archivialo dalla pagina Clienti',
        )
    }
    for (const { workspaceId, accountId } of input.assignments) {
      if (locked.get(workspaceId)?.archived) continue
      if (!(await mine(workspaceId, accountId, 'account.assigned'))) throw undoExpired()
      if (await tx.workspaceAccounts.unassign(organizationId, workspaceId, accountId))
        await recordAssignment(tx, fresh, 'account.unassigned', workspaceId, accountId, request.ip)
    }
    for (const id of workspaceIds) {
      if (locked.get(id)?.archived) continue
      if (await tx.workspaces.archive(organizationId, id, deps.clock.now()))
        await recordWorkspace(tx, fresh, 'workspace.archived', id, request.ip)
    }
  })
}

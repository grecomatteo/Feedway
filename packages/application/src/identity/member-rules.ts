import { can, DomainError, type OrgActor } from '@app/domain'
import type { AuthSessionInfo } from '../ports/auth.js'
import type { OrgMemberRecord } from '../ports/repositories.js'
import type { Tx } from '../ports/tx.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A malformed id names nothing: callers answer `NOT_FOUND`, never a database error. */
export const isUuid = (value: string): boolean => UUID.test(value)

/** Input from the routes is typed, but the values are checked again at run time. */
export function assertOneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  field: string,
): asserts value is T {
  if (!(allowed as readonly string[]).includes(value))
    throw new DomainError('VALIDATION', 'Valore non valido', { field })
}

export const memberNotFound = () => new DomainError('NOT_FOUND', 'Utente non trovato')

/** The session that proves a reauth must be the actor's own. */
export function assertActorSession(actor: OrgActor, session: AuthSessionInfo): void {
  if (session.userId !== actor.userId)
    throw new DomainError('UNAUTHENTICATED', 'Sessione scaduta: accedi di nuovo')
}

/** Only `users.manage` (Owner, Admin) acts on the agency's people. */
export function assertManagesUsers(actor: OrgActor): void {
  if (!can(actor, 'users.manage', { organizationId: actor.organizationId }))
    throw new DomainError('FORBIDDEN', 'Non hai i permessi per gestire gli utenti')
}

/**
 * A member of this agency the actor may act on, locked until the transaction ends so the checks
 * below still hold at the commit. Someone outside it, here or in another agency,
 * is not found; the Owner, and another Admin for an Admin, are forbidden (spec §10.2, note 2).
 */
export async function targetMember(
  tx: Tx,
  actor: OrgActor,
  userId: string,
): Promise<OrgMemberRecord> {
  // a malformed id is a missing member, not a database error
  if (!isUuid(userId)) throw memberNotFound()
  const member = await tx.orgMembers.findForUpdate(actor.organizationId, userId)
  if (!member) throw memberNotFound()
  if (
    !can(actor, 'users.manage', {
      organizationId: actor.organizationId,
      targetUser: { id: userId, orgRole: member.role },
    })
  )
    throw new DomainError('FORBIDDEN', 'Non puoi modificare questo utente')
  return member
}

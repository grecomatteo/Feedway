import { ANONYMIZED_NAME, anonymizedEmail, DomainError } from '@app/domain'
import type { Auth, AuthSessionInfo } from '../ports/auth.js'
import type { Clock } from '../ports/clock.js'
import type { Logger } from '../ports/logger.js'
import type { Storage } from '../ports/storage.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import type { AnonymizationSource, UserAnonymizedHandler } from './module.js'
import { assertRecentReauth } from './reauth.js'

export interface AnonymizeDeps {
  uow: UnitOfWork
  clock: Clock
  auth: Pick<Auth, 'deleteAllCredentials'>
  storage: Pick<Storage, 'deletePrefix'>
  logger: Logger
  /** `userAnonymizedHandlers()` of the composition root. */
  onUserAnonymized: readonly UserAnonymizedHandler[]
}

const soleOwner = (agency: string) =>
  new DomainError(
    'SOLE_OWNER',
    `Sei l’Owner di ${agency}: prima passa la proprietà a un Admin dalla pagina Utenti`,
  )

/**
 * The first agency the person owns, if any; any status of the membership or the agency counts.
 * Read in the person's own scope, or in the system scope.
 */
export async function ownedAgencyName(tx: Tx, userId: string): Promise<string | null> {
  const owned = (await tx.orgMembers.listForUser(userId)).find((m) => m.role === 'owner')
  return owned?.name ?? null
}

/**
 * The checks before anything is removed, under the account's row lock: nobody who owns an
 * agency, and never the platform administrator from the panel. The account is disabled here,
 * before the credentials go: from now on no session works, no export or ownership reaches it.
 */
async function prepare(tx: Tx, userId: string, at: Date, panel: boolean): Promise<void> {
  const user = await tx.users.findByIdForUpdate(userId)
  if (!user) throw new DomainError('NOT_FOUND', 'Utente non trovato')
  if (user.anonymizedAt !== null) return
  if (panel && user.platformRole === 'admin')
    throw new DomainError(
      'FORBIDDEN',
      'L’amministratore della piattaforma non può eliminare il proprio account dal pannello',
    )
  const agency = await ownedAgencyName(tx, userId)
  if (agency !== null) throw soleOwner(agency)
  await tx.users.disable(userId, at)
}

/**
 * "Elimina il mio account" (spec §15.7): the session must have been confirmed in the last
 * minutes. Refused to the Owner of an agency (SOLE_OWNER) and to the platform administrator.
 * The caller clears the session cookie afterwards.
 */
export async function deleteMyAccount(
  deps: AnonymizeDeps,
  user: { id: string },
  session: AuthSessionInfo,
  request: { ip: string | null },
): Promise<void> {
  if (session.userId !== user.id) throw new DomainError('UNAUTHENTICATED', 'Sessione non valida')
  assertRecentReauth(session, deps.clock.now())
  await anonymizeUser(deps, { userId: user.id, source: 'panel', ip: request.ip })
}

/**
 * Removes a person's personal data and keeps the history attributed to the id ("Utente
 * rimosso"). Repeatable: a run stopped half-way completes when run again, and a complete run
 * repeated changes nothing but calling the modules' handlers again. The caller has already
 * checked who may ask (`deleteMyAccount`, the platform's CLI, retention) and that the person
 * owns no agency; a membership that became Owner meanwhile stops the run before it is disabled.
 */
export async function anonymizeUser(
  deps: AnonymizeDeps,
  input: { userId: string; source: AnonymizationSource; ip?: string | null },
): Promise<void> {
  const { userId, source } = input
  const ip = input.ip ?? null
  const panel = source === 'panel'
  const now = deps.clock.now()
  // (0) the address and the agencies, read before anything changes
  const before = await deps.uow.run({ userId }, async (tx) => {
    await prepare(tx, userId, now, panel)
    const user = await tx.users.findById(userId)
    if (!user) throw new DomainError('NOT_FOUND', 'Utente non trovato')
    const agencies = (await tx.orgMembers.listForUser(userId)).map((m) => m.organizationId)
    return { email: user.email, alreadyAnonymized: user.anonymizedAt !== null, agencies }
  })

  // (1) from here no sign-in is possible
  await deps.auth.deleteAllCredentials(userId)
  // (2) photo and exports
  await deps.storage.deletePrefix(`users/${userId}/`)

  // (3) each agency, in its own scope
  for (const organizationId of before.agencies)
    await deps.uow.run({ organizationId, userId }, async (tx) => {
      const member = await tx.orgMembers.findForUpdate(organizationId, userId)
      if (member?.role === 'owner') {
        const agency = await tx.organizations.findById(organizationId)
        throw soleOwner(agency?.name ?? 'un’agenzia')
      }
      const disabled = await tx.orgMembers.setStatus(organizationId, userId, 'disabled')
      const workspaces = await tx.workspaceMembers.removeAllForUser(organizationId, userId)
      const invites = await tx.invites.expireOpenFor(
        organizationId,
        { email: before.email, userId },
        now,
      )
      if (before.alreadyAnonymized) return
      await tx.audit.record({
        organizationId,
        actorId: panel ? userId : null,
        source,
        action: 'user.anonymized',
        entity: 'user',
        entityId: userId,
        workspaceId: null,
        ip,
        data: { membershipDisabled: disabled, workspaces, invites },
      })
    })

  // (4) the account itself
  await deps.uow.run({ userId }, async (tx) => {
    await tx.sessions.deleteAllForUser(userId)
    await tx.knownDevices.deleteAllForUser(userId)
    await tx.dataExports.deleteAllForUser(userId)
    await tx.users.anonymize(userId, {
      email: anonymizedEmail(userId),
      name: ANONYMIZED_NAME,
      at: now,
    })
    // the platform records its own entry: a personal one is written by its author only
    if (panel && !before.alreadyAnonymized)
      await tx.audit.record({
        organizationId: null,
        actorId: userId,
        source,
        action: 'user.anonymized',
        entity: 'user',
        entityId: userId,
        workspaceId: null,
        ip,
        data: {},
      })
  })
  // a file an export or a photo upload wrote while the steps above ran
  await deps.storage.deletePrefix(`users/${userId}/`)

  // (5) the other modules
  for (const handler of deps.onUserAnonymized) await handler({ userId, source })
  deps.logger.info({ userId, source }, 'user anonymized')
}

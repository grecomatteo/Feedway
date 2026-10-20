import { deviceLabel, DomainError, shortenIp } from '@app/domain'
import type { Auth } from '../ports/auth.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notFound = () => new DomainError('NOT_FOUND', 'Sessione non trovata')

/** A signed-in device as the Security page shows it: never the token, never the full IP. */
export interface MySession {
  id: string
  device: { browser: string; os: string }
  ipApprox: string | null
  createdAt: Date
  lastActiveAt: Date
  current: boolean
}

export async function listMySessions(
  deps: { auth: Pick<Auth, 'listSessions'> },
  user: { id: string },
  currentSessionId: string,
): Promise<MySession[]> {
  const sessions = await deps.auth.listSessions(user.id)
  return sessions.map((s) => ({
    id: s.id,
    device: deviceLabel(s.userAgent),
    ipApprox: s.ipAddress === null ? null : shortenIp(s.ipAddress) || null,
    createdAt: s.createdAt,
    lastActiveAt: s.updatedAt,
    current: s.id === currentSessionId,
  }))
}

/** Signs out one device of the person, the current one included. */
export async function revokeMySession(
  deps: { uow: UnitOfWork },
  user: { id: string },
  sessionId: string,
  request: { ip: string | null },
): Promise<void> {
  const userId = user.id
  // a malformed id is a missing session, not a database error
  if (!UUID.test(sessionId)) throw notFound()
  await deps.uow.run({ userId }, async (tx) => {
    // someone else's session answers like a missing one
    if (!(await tx.sessions.delete(userId, sessionId))) throw notFound()
    await tx.audit.record({
      organizationId: null,
      actorId: userId,
      source: 'panel',
      action: 'session.revoked',
      entity: 'session',
      entityId: sessionId,
      workspaceId: null,
      ip: request.ip,
    })
  })
}

/** "Esci da tutti i dispositivi", this one included. Returns how many were closed. */
export async function revokeAllMySessions(
  deps: { uow: UnitOfWork },
  user: { id: string },
  request: { ip: string | null },
): Promise<number> {
  const userId = user.id
  return deps.uow.run({ userId }, async (tx) => {
    const count = await tx.sessions.deleteAllForUser(userId)
    await tx.audit.record({
      organizationId: null,
      actorId: userId,
      source: 'panel',
      action: 'session.revoked',
      entity: 'user',
      entityId: userId,
      workspaceId: null,
      ip: request.ip,
      data: { count },
    })
    return count
  })
}

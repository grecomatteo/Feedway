import { canPlatform, DomainError, type PlatformActor, type PlatformPermission } from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { AuditSource } from '../ports/audit-log.js'
import type { Clock } from '../ports/clock.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { KeyRing } from '../ports/key-ring.js'
import type { TokenService } from '../ports/token-service.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

/**
 * The command line inside the image (`cli …`): whoever runs it already controls the server.
 * Recorded with `source: 'system'` and no actor.
 */
export const SYSTEM_PLATFORM_ACTOR: { readonly kind: 'system' } = Object.freeze({
  kind: 'system',
})

/** Who runs a platform action: the platform administrator, or the system (CLI). */
export type PlatformCaller = PlatformActor | typeof SYSTEM_PLATFORM_ACTOR

export interface PlatformDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  tokens: TokenService
  keyRing: KeyRing
  config: {
    /** Origin of the panel, `https://…` */
    panelUrl: string
  }
}

/** The request behind a panel action, for the activity log. */
export interface PlatformRequest {
  ip: string | null
}

export const NO_REQUEST: PlatformRequest = { ip: null }

const forbidden = () =>
  new DomainError('FORBIDDEN', 'Solo l’amministratore della piattaforma può farlo')

// by identity: an object that only looks like the system actor (e.g. built from a request
// body) is an ordinary caller and needs the platform role
export const callerIsSystem = (caller: PlatformCaller): caller is typeof SYSTEM_PLATFORM_ACTOR =>
  caller === SYSTEM_PLATFORM_ACTOR

/** First step of every platform use case, before any transaction. */
export function assertPlatform(caller: PlatformCaller, permission: PlatformPermission): void {
  if (!callerIsSystem(caller) && !canPlatform(caller, permission)) throw forbidden()
}

export interface PlatformAuthor {
  /** null for the system. */
  actorId: string | null
  source: AuditSource
  ip: string | null
}

/**
 * Inside the system transaction: the administrator's role and account are read again, so an
 * actor built before a demotion or a disable counts for nothing.
 */
export async function platformAuthor(
  tx: Tx,
  caller: PlatformCaller,
  request: PlatformRequest,
): Promise<PlatformAuthor> {
  if (callerIsSystem(caller)) return { actorId: null, source: 'system', ip: null }
  const user = isUuid(caller.userId) ? await tx.users.findById(caller.userId) : null
  if (user?.platformRole !== 'admin' || user.status !== 'active' || user.anonymizedAt !== null)
    throw forbidden()
  return { actorId: user.id, source: 'panel', ip: request.ip }
}

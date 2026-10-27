import { deviceLabel, DomainError, shortenIp, type AuthMethod } from '@app/domain'
import type { AuditAction } from '../ports/audit-log.js'
import type { Clock } from '../ports/clock.js'
import type { JobQueue, SecurityEmailKind } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { SignedTokens } from '../ports/token-service.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

export type AuthEvent =
  | {
      kind: 'login'
      userId: string
      sessionId: string
      method: AuthMethod
      ip: string | null
      userAgent: string | null
      /** The `__Host-device` cookie id; null counts as a new device. */
      deviceId: string | null
      previousSessionId: string | null
    }
  | {
      kind: 'login_failed'
      stage: 'password' | 'second_factor'
      /** Never stored: it only tells the caller who tried. */
      email: string | null
      /** null when the email belongs to nobody. */
      userId: string | null
      ip: string | null
    }
  | { kind: 'logout'; userId: string; sessionId: string; ip: string | null }
  | {
      kind: Exclude<SecurityEmailKind, 'new_device'>
      userId: string
      ip: string | null
      userAgent: string | null
    }

export interface AuthEventContext {
  requestId: string | null
}

/** Called by the Better Auth hooks after the library has done its work. */
export interface AuthEventSink {
  /** Never throws: a failure is logged, the sign-in or change has already happened. */
  record(event: AuthEvent, context: AuthEventContext): Promise<void>
}

export interface AuthEventDeps {
  uow: UnitOfWork
  queue: JobQueue
  tokens: SignedTokens
  clock: Clock
  logger: Logger
}

/** Job data outlives the audit IP shortening (§15.7): it carries only the short form. */
const jobIp = (ip: string | null) => (ip === null ? null : shortenIp(ip) || null)

/** "Safari su iOS": what the person reads in the email and in the activity log. */
export function readableDevice(userAgent: string | null): string {
  const { browser, os } = deviceLabel(userAgent)
  return `${browser} su ${os}`
}

async function recordLogin(deps: AuthEventDeps, event: Extract<AuthEvent, { kind: 'login' }>) {
  const { userId, sessionId, ip } = event
  const now = deps.clock.now()
  const device = readableDevice(event.userAgent)
  const alert = await deps.uow.run({ userId }, async (tx) => {
    await tx.users.setLastLoginAt(userId, now)
    await tx.sessions.setAuthMethod(userId, sessionId, event.method)
    // A passkey sign-in over a valid session of the same person is a reauth: the new session
    // starts confirmed and replaces the old one. `delete` only reaches this person's sessions.
    const reauth =
      event.method === 'passkey' &&
      event.previousSessionId !== null &&
      (await tx.sessions.delete(userId, event.previousSessionId))
    if (reauth) {
      await tx.sessions.setReauthenticated(userId, sessionId, now)
      await tx.audit.record({
        organizationId: null,
        actorId: userId,
        source: 'panel',
        action: 'auth.reauthenticated',
        entity: 'session',
        entityId: sessionId,
        workspaceId: null,
        ip,
        data: { method: event.method },
      })
    }
    const knownBefore = await tx.knownDevices.count(userId)
    // Without the cookie id we cannot tell the device apart: it counts as new.
    const isNew =
      event.deviceId === null ||
      (await tx.knownDevices.touch(userId, deps.tokens.deviceHash(userId, event.deviceId), now))
    await tx.audit.record({
      organizationId: null,
      actorId: userId,
      source: 'panel',
      action: 'auth.login',
      entity: 'session',
      entityId: sessionId,
      workspaceId: null,
      ip,
      data: {
        method: event.method,
        device,
        ...(event.previousSessionId === null ? {} : { previousSessionId: event.previousSessionId }),
      },
    })
    // The very first device is not news: the person has just set up the account.
    const newDevice = isNew && knownBefore > 0
    if (newDevice) {
      await tx.audit.record({
        organizationId: null,
        actorId: userId,
        source: 'panel',
        action: 'auth.new_device',
        entity: 'session',
        entityId: sessionId,
        workspaceId: null,
        ip,
        data: { device },
      })
    }
    return newDevice
  })
  if (alert) {
    await deps.queue.send('identity.security_email', {
      userId,
      kind: 'new_device',
      occurredAt: now.toISOString(),
      deviceLabel: device,
      ip: jobIp(ip),
    })
  }
}

async function recordLoginFailed(
  deps: AuthEventDeps,
  event: Extract<AuthEvent, { kind: 'login_failed' }>,
) {
  const action: AuditAction =
    event.stage === 'password' ? 'auth.login_failed' : 'auth.second_factor_failed'
  // The attempted email and password are never written: only who it was, if anyone.
  const entry = {
    organizationId: null,
    actorId: event.userId,
    source: 'panel' as const,
    action,
    entity: 'user',
    entityId: event.userId,
    workspaceId: null,
    ip: event.ip,
  }
  if (event.userId === null) {
    // Nobody to scope it to: a personal entry of no one, readable only by the platform.
    await deps.uow.runAsSystem('failed sign-in for an unknown email', (tx) =>
      tx.audit.record(entry),
    )
    return
  }
  await deps.uow.run({ userId: event.userId }, (tx) => tx.audit.record(entry))
}

async function recordChange(
  deps: AuthEventDeps,
  event: Extract<AuthEvent, { kind: Exclude<SecurityEmailKind, 'new_device'> }>,
) {
  const { userId, ip } = event
  const now = deps.clock.now()
  await deps.uow.run({ userId }, (tx) =>
    tx.audit.record({
      organizationId: null,
      actorId: userId,
      source: 'panel',
      action: `auth.${event.kind}`,
      entity: 'user',
      entityId: userId,
      workspaceId: null,
      ip,
    }),
  )
  await deps.queue.send('identity.security_email', {
    userId,
    kind: event.kind,
    occurredAt: now.toISOString(),
    deviceLabel: readableDevice(event.userAgent),
    ip: jobIp(ip),
  })
}

async function handle(deps: AuthEventDeps, event: AuthEvent): Promise<void> {
  switch (event.kind) {
    case 'login':
      return recordLogin(deps, event)
    case 'login_failed':
      return recordLoginFailed(deps, event)
    case 'logout':
      return deps.uow.run({ userId: event.userId }, (tx) =>
        tx.audit.record({
          organizationId: null,
          actorId: event.userId,
          source: 'panel',
          action: 'auth.logout',
          entity: 'session',
          entityId: event.sessionId,
          workspaceId: null,
          ip: event.ip,
        }),
      )
    default:
      return recordChange(deps, event)
  }
}

export function createAuthEventSink(deps: AuthEventDeps): AuthEventSink {
  return {
    async record(event, context) {
      try {
        await handle(deps, event)
      } catch (error) {
        deps.logger.error(
          { requestId: context.requestId, event: event.kind, err: error },
          'auth event not recorded',
        )
      }
    },
  }
}

export interface LockDeps {
  uow: UnitOfWork
  tokens: SignedTokens
  clock: Clock
  /** Queues the notice to the administrators (`identity.account_locked_notice`). */
  queue: Pick<JobQueue, 'send'>
}

const LINK_INVALID_MESSAGE = 'Il link non è valido o è scaduto.'

/**
 * "Non sono stato io" from a security email: disables the account, closes every session,
 * revokes every pending link, forgets the known devices and revokes the open invites the person
 * sent, all in one transaction, and tells
 * the administrators. Safe to repeat; re-enabling is a platform administrator's job after
 * checking the person's identity (`cli enable-user --verified-by`), and links issued before that
 * reactivation are refused.
 */
export async function lockAccountFromSecurityEmail(
  deps: LockDeps,
  input: { token: string; ip: string | null },
): Promise<void> {
  const now = deps.clock.now()
  const claim = deps.tokens.verify('security_lock', input.token, now)
  if (claim === null) throw new DomainError('LINK_INVALID', LINK_INVALID_MESSAGE)
  const { userId } = claim
  // System scope: the invites the person sent belong to their agencies, and they are revoked in
  // this same transaction. The person is only the one the signed link names.
  await deps.uow.runAsSystem('security lock from a signed link', async (tx) => {
    const user = await tx.users.findByIdForUpdate(userId)
    if (user === null) throw new DomainError('LINK_INVALID', LINK_INVALID_MESSAGE)
    // a link from before the last reactivation (an old email) must not lock the account again
    if (
      user.reactivatedAt !== null &&
      (claim.issuedAt === null || claim.issuedAt.getTime() <= user.reactivatedAt.getTime())
    )
      throw new DomainError('LINK_INVALID', LINK_INVALID_MESSAGE)
    if (user.anonymizedAt !== null) return
    const disabled = await tx.users.disable(userId, now)
    // also when the platform had disabled it already: the reactivation must void the password
    const marked = await tx.users.markSecurityLocked(userId, now)
    const sessionsClosed = await tx.sessions.deleteAllForUser(userId)
    const tokensRevoked =
      (await tx.credentials.revokePendingTokens(userId)) +
      (await tx.knownDevices.deleteAllForUser(userId))
    // whoever had the account may have invited accomplices: their links stop working
    const sent = await tx.invites.listOpenSentBy(userId, now)
    for (const invite of sent) {
      await tx.invites.expire(invite.id, now)
      await tx.audit.record({
        organizationId: invite.organizationId,
        actorId: userId,
        source: 'panel',
        action: 'user.invite_revoked',
        entity: 'invite',
        entityId: invite.id,
        workspaceId: null,
        ip: input.ip,
        data: { reason: 'security_lock' },
      })
    }
    const invitesRevoked = sent.length
    if (!disabled && !marked && sessionsClosed === 0 && tokensRevoked === 0 && invitesRevoked === 0)
      return
    await tx.audit.record({
      organizationId: null,
      actorId: userId,
      source: 'panel',
      action: 'auth.security_lock',
      entity: 'user',
      entityId: userId,
      workspaceId: null,
      ip: input.ip,
      data: { sessionsClosed, tokensRevoked, invitesRevoked },
    })
    // Once per lock. Queued before the commit: if it fails, nothing is locked and the person can
    // retry; the handler waits for the commit (it retries until it sees this lock).
    if (marked)
      await deps.queue.send('identity.account_locked_notice', {
        lockedUserId: userId,
        lockedAt: now.toISOString(),
      })
  })
}

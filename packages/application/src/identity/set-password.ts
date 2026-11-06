import { checkPassword, DomainError } from '@app/domain'
import type { Auth, AuthSessionInfo } from '../ports/auth.js'
import type { Clock } from '../ports/clock.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import type { AuthEventSink } from './auth-events.js'
import type { PasswordStrength } from './identity-deps.js'
import { assertRecentReauth } from './reauth.js'

export interface SetPasswordDeps {
  uow: UnitOfWork
  clock: Clock
  auth: Pick<Auth, 'setPasswordIfNone'>
  passwordStrength: PasswordStrength
  events: AuthEventSink
}

const recoveryOnly = () =>
  new DomainError(
    'FORBIDDEN',
    'Per questo account la password si sceglie dal link di recupero ricevuto per email',
  )

const alreadySet = () =>
  new DomainError('CONFLICT', 'Hai già una password: cambiala con quella attuale')

/**
 * The first password of an account without one: passkeys only, or an activation whose passkey
 * never came. With no way in at all the session is the only proof there is; with passkeys the
 * session must have been confirmed in the last minutes, as for any other new way in. An account
 * waiting for its recovery link gets its password only from that link.
 */
export async function setFirstPassword(
  deps: SetPasswordDeps,
  session: AuthSessionInfo,
  input: { password: string },
  request: { ip: string | null; userAgent: string | null; requestId: string },
): Promise<void> {
  const { userId } = session
  await deps.uow.run({ userId }, async (tx) => {
    const user = await tx.users.findById(userId)
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Sessione scaduta: accedi di nuovo')
    if (await tx.credentials.hasPassword(userId)) throw alreadySet()
    if (user.securityLockedAt !== null) throw recoveryOnly()
    if ((await tx.users.countPasskeys(userId)) > 0) assertRecentReauth(session, deps.clock.now())
    const check = checkPassword(
      input.password,
      { email: user.email, name: user.name },
      deps.passwordStrength,
    )
    if (!check.ok)
      throw new DomainError('VALIDATION', 'La password non è abbastanza robusta', {
        field: 'password',
        reason: check.reason,
      })
  })
  // checked again with the write, under the account's lock: a recovery may have come meanwhile
  const outcome = await deps.auth.setPasswordIfNone(userId, input.password)
  if (outcome === 'already_set') throw alreadySet()
  if (outcome === 'unavailable') throw recoveryOnly()
  await deps.events.record(
    { kind: 'password_changed', userId, ip: request.ip, userAgent: request.userAgent },
    { requestId: request.requestId },
  )
}

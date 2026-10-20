import type { PasskeySummary } from '../ports/auth.js'
import type { IdentityDeps } from './identity-deps.js'
import type { SessionUser } from './sessions.js'

export interface SecondFactorOverview {
  /** The person's role or agency asks for a second factor. */
  required: boolean
  totpEnabled: boolean
  passkeys: PasskeySummary[]
}

/** The Security page: which factors the person holds and whether one is mandatory. */
export async function secondFactorOverview(
  deps: Pick<IdentityDeps, 'auth'>,
  user: Pick<SessionUser, 'id' | 'secondFactor'>,
): Promise<SecondFactorOverview> {
  const { totpEnabled, passkeys } = await deps.auth.secondFactorStatus(user.id)
  return { required: user.secondFactor.required, totpEnabled, passkeys }
}

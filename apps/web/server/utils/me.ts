import type { SessionState, SessionUser } from '@app/application'
import type { Me } from '@app/contracts'

/** The answer of the routes that return the signed-in person. */
export async function meOf(user: SessionUser, sessionState: SessionState): Promise<Me> {
  return { ...user, sessionState, emailNotices: await useDeps().mailer.isConfigured() }
}

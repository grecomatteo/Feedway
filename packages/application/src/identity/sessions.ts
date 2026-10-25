import {
  avatarUrl,
  displayName,
  requiresSecondFactor,
  sessionSatisfiesSecondFactor,
  type OrgRole,
} from '@app/domain'
import type { AuthSessionInfo } from '../ports/auth.js'
import type { IdentityDeps } from './identity-deps.js'

export interface SessionUser {
  id: string
  email: string
  name: string
  nickname: string | null
  displayName: string
  platformRole: 'admin' | null
  avatarUrl: string | null
  theme: 'light' | 'dark' | 'system'
  locale: string
  timezone: string | null
  lastOrganizationSlug: string | null
  /** Active memberships only; a suspended agency is listed with its status. */
  organizations: {
    id: string
    slug: string
    name: string
    role: OrgRole
    status: 'active' | 'suspended'
  }[]
  secondFactor: { required: boolean; totpEnabled: boolean; passkeys: number }
}

export type SessionState = 'active' | 'second_factor_required'

export interface ResolvedSession {
  user: SessionUser
  session: AuthSessionInfo
  state: SessionState
  /** The renewed session cookie, to forward with the answer (see `Auth.getSession`). */
  setCookie: string[]
}

/** What `resolveSessionUser` needs: also built for the Better Auth hooks, which have no `Auth`. */
export type SessionUserDeps = Pick<IdentityDeps, 'uow'> & {
  config: Pick<IdentityDeps['config'], 'require2fa'>
}

/**
 * The person behind a request. Null without a valid session; a disabled or anonymized person
 * is signed out everywhere on the spot.
 */
export async function resolveSession(
  deps: Pick<IdentityDeps, 'uow' | 'auth' | 'config'>,
  input: { headers: Headers },
): Promise<ResolvedSession | null> {
  // the adapter drops sessions past 12 h idle or 30 days from creation
  const found = await deps.auth.getSession(input.headers)
  if (!found) return null
  const resolved = await resolveSessionUser(deps, found.session)
  if (!resolved) {
    await deps.auth.revokeAllSessions(found.userId)
    return null
  }
  return { session: found.session, setCookie: found.setCookie, ...resolved }
}

/**
 * The person of a session already known to be valid, and whether that session still owes the
 * second factor. Null for a disabled or anonymized person: the caller closes the sessions.
 */
export async function resolveSessionUser(
  deps: SessionUserDeps,
  session: AuthSessionInfo,
): Promise<{ user: SessionUser; state: SessionState } | null> {
  const { userId } = session
  const loaded = await deps.uow.run({ userId }, async (tx) => {
    const user = await tx.users.findById(userId)
    if (!user || user.status !== 'active' || user.anonymizedAt !== null) return null
    const memberships = (await tx.orgMembers.listForUser(userId)).filter(
      (m) => m.status === 'active',
    )
    return { user, memberships, passkeys: await tx.users.countPasskeys(userId) }
  })
  if (!loaded) return null
  const { user, memberships, passkeys } = loaded

  const required = requiresSecondFactor({
    platformRole: user.platformRole,
    platformPolicy: deps.config.require2fa,
    orgRoles: memberships.map((m) => ({ role: m.role, policy: m.require2fa ?? 'admins' })),
  })
  // a suspended agency would only answer 403: the panel picks another one
  const last = memberships.find(
    (m) => m.organizationId === user.lastOrganizationId && m.organizationStatus === 'active',
  )
  return {
    state:
      required && !sessionSatisfiesSecondFactor(session.authMethod)
        ? 'second_factor_required'
        : 'active',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      nickname: user.nickname,
      displayName: displayName(user),
      platformRole: user.platformRole,
      avatarUrl: avatarUrl(user.id, user.avatarKey),
      theme: user.theme,
      locale: user.locale,
      timezone: user.timezone,
      lastOrganizationSlug: last?.slug ?? null,
      organizations: memberships.map((m) => ({
        id: m.organizationId,
        slug: m.slug,
        name: m.name,
        role: m.role,
        status: m.organizationStatus,
      })),
      secondFactor: { required, totpEnabled: user.twoFactorEnabled, passkeys },
    },
  }
}

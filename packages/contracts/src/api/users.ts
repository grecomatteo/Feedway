import { z } from 'zod'
import { defineContract } from './define.js'
import { Id, OrgParams, OrgRole, OrgSlug, Timestamp, WorkspaceRole } from './common.js'

/** A person of the agency, as Owner and Admin see them: no hash, token or secret. */
export const Member = z.object({
  id: z.string(),
  displayName: z.string(),
  name: z.string(),
  nickname: z.string().nullable(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  orgRole: OrgRole,
  status: z.enum(['active', 'disabled']),
  secondFactorConfigured: z.boolean(),
  workspaces: z.array(z.object({ id: z.string(), name: z.string(), role: WorkspaceRole })),
  lastLoginAt: Timestamp.nullable(),
})

export const listMembersRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/members',
  summary: 'Gli utenti dell’agenzia',
  request: { params: OrgParams },
  response: z.object({ items: z.array(Member) }),
  auth: 'session',
  scope: 'organization',
})

export const InviteBody = z.strictObject({
  email: z.string().min(1).max(320),
  orgRole: z.enum(['member', 'admin']),
  memberships: z
    .array(z.strictObject({ workspaceId: Id, role: WorkspaceRole }))
    .max(100)
    .default([]),
})

export const inviteRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/invites',
  summary: 'Crea il link d’invito da copiare (valido 72 ore)',
  request: { params: OrgParams, body: InviteBody },
  response: z.object({ url: z.string(), expiresAt: Timestamp }),
  auth: 'session',
  scope: 'organization',
})

const MemberParams = z.strictObject({ org: OrgSlug, userId: Id })

export const passwordResetLinkRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/members/{userId}/password-reset-link',
  summary: 'Crea un link di reset della password da copiare (con riconferma)',
  request: { params: MemberParams },
  response: z.object({ url: z.string() }),
  auth: 'session',
  scope: 'organization',
})

export const disableMemberRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/members/{userId}/disable',
  summary: 'Disattiva l’utente in questa agenzia e lo scollega ovunque',
  request: { params: MemberParams },
  response: z.object({ status: z.literal('disabled') }),
  auth: 'session',
  scope: 'organization',
})

export const enableMemberRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/members/{userId}/enable',
  summary: 'Riattiva l’utente in questa agenzia (con riconferma)',
  request: { params: MemberParams },
  response: z.object({ status: z.literal('active') }),
  auth: 'session',
  scope: 'organization',
})

export const changeRoleRoute = defineContract({
  method: 'PUT',
  path: '/api/v1/orgs/{org}/members/{userId}/role',
  summary: 'Cambia il ruolo nell’agenzia (Owner, con riconferma); scollega l’utente',
  request: { params: MemberParams, body: z.strictObject({ role: z.enum(['admin', 'member']) }) },
  response: z.object({ role: z.enum(['admin', 'member']) }),
  auth: 'session',
  scope: 'organization',
})

export const ownershipTransferRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/ownership-transfer',
  summary: 'Passa la proprietà a un Admin attivo (Owner, con riconferma)',
  request: { params: OrgParams, body: z.strictObject({ userId: Id }) },
  response: z.object({ transferred: z.literal(true) }),
  auth: 'session',
  scope: 'organization',
})

export const userRoutes = [
  listMembersRoute,
  inviteRoute,
  passwordResetLinkRoute,
  disableMemberRoute,
  enableMemberRoute,
  changeRoleRoute,
  ownershipTransferRoute,
] as const

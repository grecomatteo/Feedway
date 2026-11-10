import { z } from 'zod'
import { defineContract } from './define.js'
import { Id, OrgParams, OrgSlug, Timestamp } from './common.js'

// Connections and the import of social accounts (spec §8.1 steps 4–5, §8.2, plan 03 Task 6).
// The token goes in once and never comes back: no answer carries it.

export const ConnectionKind = z.enum(['meta_system_user', 'meta_business_login'])
export const ConnectionStatus = z.enum(['pending', 'active', 'expired', 'revoked'])
export const Platform = z.enum(['instagram', 'facebook'])

/** A connection as Owner and Admin see it. */
export const Connection = z.object({
  id: Id,
  kind: ConnectionKind,
  status: ConnectionStatus,
  /** null: the token does not expire. */
  expiresAt: Timestamp.nullable(),
  createdAt: Timestamp,
})

/** An account the connection sees on the platform, with what importing it would do. */
export const ImportableAccount = z.object({
  platform: Platform,
  externalId: z.string(),
  name: z.string(),
  username: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  /** The key of the profile (§3): the page of the pair, null for an account alone. */
  pageId: z.string().nullable(),
  state: z.enum(['imported', 'other_connection', 'to_import', 'not_importable']),
  /** Why it cannot be imported: `role_missing`, no role on the page. */
  problem: z.enum(['role_missing']).nullable(),
  accountId: Id.nullable(),
})

/** A social account of the agency. */
export const SocialAccount = z.object({
  id: Id,
  platform: Platform,
  externalId: z.string(),
  name: z.string(),
  username: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  pageId: z.string().nullable(),
  active: z.boolean(),
  /** null: never checked yet, so not selectable for a post. */
  health: z.enum(['ok', 'warning', 'error']).nullable(),
})

const PermissionCheck = z.object({ name: z.string(), granted: z.boolean() })

const ConnectionParams = z.strictObject({ org: OrgSlug, connectionId: Id })

export const connectSystemUserRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/connections/system-user',
  summary:
    'Collega l’utente di sistema con il suo token (Owner e Admin, con riconferma): si salva solo se Meta lo accetta con tutti i permessi',
  request: {
    params: OrgParams,
    body: z.strictObject({ token: z.string().min(1).max(4096) }),
  },
  response: z.object({
    outcome: z.enum(['connected', 'replaced', 'permissions_missing']),
    permissions: z.array(PermissionCheck),
    connection: Connection.nullable(),
    accounts: z.array(ImportableAccount),
  }),
  auth: 'session',
  scope: 'organization',
})

export const importableAccountsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/connections/{connectionId}/importable',
  summary: '«Cerca nuovi account»: gli account che il collegamento vede ora su Meta',
  request: { params: ConnectionParams },
  response: z.object({ connection: Connection, accounts: z.array(ImportableAccount) }),
  auth: 'session',
  scope: 'organization',
})

export const importAccountsRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/connections/{connectionId}/import',
  summary: 'Importa gli account scelti fra quelli che il collegamento vede',
  request: {
    params: ConnectionParams,
    body: z.strictObject({ externalIds: z.array(z.string().max(64)).min(1).max(100) }),
  },
  response: z.object({ connection: Connection, accounts: z.array(SocialAccount) }),
  auth: 'session',
  scope: 'organization',
})

export const accountRoutes = [
  connectSystemUserRoute,
  importableAccountsRoute,
  importAccountsRoute,
] as const

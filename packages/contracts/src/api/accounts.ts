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

export const syncConnectionRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/connections/{connectionId}/sync',
  summary:
    'Aggiorna gli account del collegamento e la loro salute (Owner e Admin, al massimo una volta ogni 5 minuti): il lavoro parte in coda',
  request: { params: ConnectionParams },
  response: z.object({ queued: z.literal(true) }),
  auth: 'session',
  scope: 'organization',
})

// «Account social» and the profiles of a workspace (spec §3, §14.4, plan 03 Task 9)

const Health = z.enum(['ok', 'warning', 'error'])

/** An account as a workspace sees it: nothing of the connection that reaches it. */
export const WorkspaceAccount = z.object({
  id: Id,
  platform: Platform,
  externalId: z.string(),
  name: z.string(),
  username: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  pageId: z.string().nullable(),
  active: z.boolean(),
  /** null: never checked yet. */
  health: Health.nullable(),
  healthMessage: z.string().nullable(),
  /** Can be a destination of a post now. */
  selectable: z.boolean(),
  quota: z.object({ used: z.number(), total: z.number(), checkedAt: Timestamp }).nullable(),
  lastSyncedAt: Timestamp.nullable(),
})

export const AccountListItem = WorkspaceAccount.extend({
  /** Its workspaces, among those the person sees. */
  workspaceIds: z.array(Id),
  /** Owner and Admin only; null for everyone else. */
  connection: z.object({ id: Id, kind: ConnectionKind, status: ConnectionStatus }).nullable(),
  createdAt: Timestamp,
})

export const listAccountsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/accounts',
  summary:
    'Gli account social: Owner e Admin tutti, gli altri quelli dei propri spazi; 50 per pagina',
  request: {
    params: OrgParams,
    query: z.strictObject({
      cursor: Id.optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  response: z.object({ items: z.array(AccountListItem), nextCursor: Id.nullable() }),
  auth: 'session',
  scope: 'organization',
})

const WorkspaceAccountParams = z.strictObject({ org: OrgSlug, id: Id, accountId: Id })

export const assignAccountRoute = defineContract({
  method: 'PUT',
  path: '/api/v1/orgs/{org}/workspaces/{id}/accounts/{accountId}',
  summary: 'Assegna un account attivo allo spazio (Owner e Admin)',
  request: { params: WorkspaceAccountParams },
  response: z.object({ assigned: z.literal(true) }),
  auth: 'session',
  scope: 'organization',
})

export const unassignAccountRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/orgs/{org}/workspaces/{id}/accounts/{accountId}',
  summary: 'Toglie un account dallo spazio (Owner e Admin)',
  request: { params: WorkspaceAccountParams },
  response: z.object({ removed: z.literal(true) }),
  auth: 'session',
  scope: 'organization',
})

export const workspaceProfilesRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/profiles',
  summary: 'I profili dello spazio: Instagram e Pagina che Meta collega, solo fra i suoi account',
  request: { params: z.strictObject({ org: OrgSlug, id: Id }) },
  response: z.object({
    items: z.array(z.object({ key: z.string(), id: Id, accounts: z.array(WorkspaceAccount) })),
  }),
  auth: 'session',
  scope: 'organization',
})

const CalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** What Owner and Admin are reminded of about Meta (§8.4, RF-21); the panel words it. */
export const MetaReminder = z.discriminatedUnion('kind', [
  /** `daysLeft` below zero: the version is already retired. */
  z.object({
    kind: z.literal('graph_version_sunset'),
    version: z.string(),
    dueOn: CalendarDate,
    daysLeft: z.number().int(),
  }),
  /** `daysLeft` below zero: overdue. */
  z.object({
    kind: z.literal('data_use_checkup'),
    dueOn: CalendarDate,
    daysLeft: z.number().int(),
  }),
  z.object({ kind: z.literal('access_revoked'), connectionId: Id }),
  z.object({ kind: z.literal('token_expiring'), connectionId: Id, expiresAt: Timestamp }),
])

export const metaRemindersRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/accounts/reminders',
  summary:
    'I promemoria di Meta per Owner e Admin: versione della Graph API al ritiro, Data Use Checkup, accessi tolti e token in scadenza',
  request: { params: OrgParams },
  response: z.object({ items: z.array(MetaReminder) }),
  auth: 'session',
  scope: 'organization',
})

export const accountRoutes = [
  connectSystemUserRoute,
  importableAccountsRoute,
  importAccountsRoute,
  syncConnectionRoute,
  listAccountsRoute,
  metaRemindersRoute,
  assignAccountRoute,
  unassignAccountRoute,
  workspaceProfilesRoute,
] as const

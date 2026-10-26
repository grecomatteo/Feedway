import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { apiRoutes } from '@app/contracts'
import type { ApiContract } from '@app/contracts'
import { AUDIT_ACTIONS } from '@app/application'
import type { AuditAction } from '@app/application'
import type { Permission } from '@app/domain'
import { MATRIX } from '@app/domain/testing'
import {
  ACTOR_ROLES,
  fill,
  namesWorkspace,
  pathValues,
  routeByKey,
  routeKey,
  sampleBody,
  sampleQuery,
  startIsolationFixture,
} from './support/isolation-fixture.js'
import type { ActorRole, IsolationFixture } from './support/isolation-fixture.js'

let fx: IsolationFixture

beforeAll(async () => {
  fx = await startIsolationFixture('matrix')
}, 300_000)

afterAll(async () => {
  await fx.env.stop()
})

beforeEach(async () => {
  // REAUTH_REQUIRED would hide the permission the case is about
  await fx.refreshReauth()
})

/**
 * What each agency route checks, as a row of the matrix (spec §10.2). `workspace`: the
 * permission is checked in the workspace the request names, so a workspace where the person has
 * no role is not found for them. `ownerOnly`: the Owner only, whatever the matrix row says of
 * Admin (spec §10.2, note 2: only the Owner names Admins and hands over the agency).
 * `signsOutActor`: success signs the actor out, so it runs in an agency of its own.
 */
interface Rule {
  permission: Permission
  level: 'organization' | 'workspace'
  ownerOnly?: true
  signsOutActor?: true
  /** the case adds the route's sample query */
  query?: true
}

const RULES: Record<string, readonly Rule[]> = {
  'GET /api/v1/orgs/{org}/settings': [
    { permission: 'organization.settings.view', level: 'organization' },
  ],
  'PATCH /api/v1/orgs/{org}/settings': [
    { permission: 'organization.settings.manage', level: 'organization' },
  ],
  'GET /api/v1/orgs/{org}/members': [{ permission: 'users.manage', level: 'organization' }],
  // users.manage (Owner, Admin) or, inside a workspace, workspace.members.manage
  'POST /api/v1/orgs/{org}/invites': [
    { permission: 'workspace.members.manage', level: 'workspace' },
  ],
  'POST /api/v1/orgs/{org}/members/{userId}/password-reset-link': [
    { permission: 'users.manage', level: 'organization' },
  ],
  'POST /api/v1/orgs/{org}/members/{userId}/disable': [
    { permission: 'users.manage', level: 'organization' },
  ],
  'POST /api/v1/orgs/{org}/members/{userId}/enable': [
    { permission: 'users.manage', level: 'organization' },
  ],
  'PUT /api/v1/orgs/{org}/members/{userId}/role': [
    { permission: 'users.manage', level: 'organization', ownerOnly: true },
  ],
  'POST /api/v1/orgs/{org}/ownership-transfer': [
    { permission: 'users.manage', level: 'organization', ownerOnly: true, signsOutActor: true },
  ],
  'GET /api/v1/orgs/{org}/workspaces': [{ permission: 'workspace.view', level: 'organization' }],
  'POST /api/v1/orgs/{org}/workspaces': [{ permission: 'workspace.create', level: 'organization' }],
  // changing a workspace is for those who create them: Owner and Admin
  'PATCH /api/v1/orgs/{org}/workspaces/{id}': [
    { permission: 'workspace.create', level: 'organization' },
  ],
  'POST /api/v1/orgs/{org}/workspaces/{id}/archive': [
    { permission: 'workspace.create', level: 'organization' },
  ],
  'GET /api/v1/orgs/{org}/workspaces/{id}/members': [
    { permission: 'workspace.view', level: 'workspace' },
  ],
  'POST /api/v1/orgs/{org}/workspaces/{id}/members': [
    { permission: 'workspace.members.manage', level: 'workspace' },
  ],
  'PUT /api/v1/orgs/{org}/workspaces/{id}/members/{userId}': [
    { permission: 'workspace.members.manage', level: 'workspace' },
  ],
  'DELETE /api/v1/orgs/{org}/workspaces/{id}/members/{userId}': [
    { permission: 'workspace.members.manage', level: 'workspace' },
  ],
  'GET /api/v1/orgs/{org}/audit-log': [
    { permission: 'audit.view_all', level: 'organization' },
    { permission: 'audit.view_workspace', level: 'workspace', query: true },
  ],
}

const orgRoutes = apiRoutes.filter((r) => r.scope === 'organization')

/** Members hold their role in w1 only; w2 is a workspace of the agency where they have none. */
type Where = 'w1' | 'w2' | null

function expectedStatus(rule: Rule, role: ActorRole, where: Where): number {
  const cell = MATRIX[rule.permission][role]
  if (cell === 'own') throw new Error(`${rule.permission}: "own" needs a resource of the actor`)
  const seesEveryWorkspace = role === 'owner' || role === 'admin'
  if (rule.level === 'workspace' && where === 'w2' && !seesEveryWorkspace) return 404
  return cell && (!rule.ownerOnly || role === 'owner') ? 200 : 403
}

interface AccessCase {
  role: ActorRole
  method: ApiContract['method']
  path: string
  key: string
  rule: Rule
  where: Where
  status: number
}

const accessCases: AccessCase[] = orgRoutes.flatMap((route) =>
  (RULES[routeKey(route)] ?? []).flatMap((rule) =>
    (rule.query || namesWorkspace(route) ? (['w1', 'w2'] as const) : [null]).flatMap((where) =>
      ACTOR_ROLES.map((role) => ({
        role,
        method: route.method,
        path: route.path + (rule.query ? ' ?query' : ''),
        key: routeKey(route),
        rule,
        where,
        status: expectedStatus(rule, role, where),
      })),
    ),
  ),
)

test('every agency route has an access rule, and every rule a route', () => {
  expect(orgRoutes.map(routeKey).filter((key) => !(key in RULES))).toEqual([])
  expect(Object.keys(RULES).filter((key) => !orgRoutes.some((r) => routeKey(r) === key))).toEqual(
    [],
  )
})

test.each(accessCases)('$role $method $path ($where) → $status', async (c) => {
  const route = routeByKey(c.key)
  let cookie = fx.cookies[c.role]
  let ids = await fx.caseIds({ agency: 'a', actorsInWorkspace: c.where !== 'w2' })
  if (c.rule.signsOutActor && c.status === 200) {
    if (c.role !== 'owner') throw new Error('an agency of its own has only an Owner')
    ;({ cookie, ids } = await fx.throwawayAgency())
  }
  const query = c.rule.query ? sampleQuery(route, ids) : undefined
  if (c.rule.query && query === undefined) throw new Error(`no sample query for ${c.key}`)
  const path = fill(route.path, pathValues(ids)) + (query === undefined ? '' : `?${query}`)
  const r = await fx.env.call(route.method, path, sampleBody(route, ids), { cookie })
  expect(r.status, await r.text()).toBe(c.status)
})

test.each(apiRoutes.filter((r) => r.auth !== 'public'))(
  'without a session $method $path → 401',
  async (route) => {
    const ids = await fx.caseIds({ agency: 'a', actorsInWorkspace: true })
    const path = fill(route.path, { ...pathValues(ids), token: 'link-qualsiasi' })
    expect((await fx.env.call(route.method, path, sampleBody(route, ids))).status).toBe(401)
  },
)

// ---------------------------------------------------------------------------------------------
// Activity log: what `AuditItem.data` may hold, action by action. A key not listed here, or a
// value that looks like an email, an address or a token, fails; so does an action without a
// list. The rows are read straight from the table (agency, personal and platform entries), after
// the battery above has run every agency action.

const AUDIT_DATA_KEYS: Readonly<Record<AuditAction, readonly string[]>> = {
  'auth.login': ['method', 'device', 'previousSessionId'],
  'auth.login_failed': [],
  'auth.second_factor_failed': [],
  'auth.logout': [],
  'auth.password_changed': [],
  'auth.password_reset': [],
  'auth.email_change_requested': [],
  'auth.email_changed': [],
  'auth.totp_enabled': [],
  'auth.totp_disabled': [],
  'auth.backup_codes_regenerated': [],
  'auth.passkey_added': [],
  'auth.passkey_removed': [],
  'auth.reauthenticated': ['method'],
  'auth.new_device': ['device'],
  'auth.security_lock': ['sessionsClosed'],
  'session.revoked': ['count'],
  'user.invited': ['orgRole', 'memberships'],
  'user.activated': ['purpose', 'role'],
  'user.disabled': ['scope', 'sessionsClosed'],
  'user.enabled': ['scope', 'sessionsClosed', 'passwordCleared', 'resetLinkIssued'],
  'user.role_changed': ['from', 'to'],
  'user.password_reset_link': [],
  'user.profile_updated': [],
  'user.avatar_changed': [],
  'user.data_exported': [],
  'user.anonymized': [],
  'user.anonymization_scheduled': [],
  'user.anonymization_skipped': [],
  'organization.created': ['ownerId', 'inviteId'],
  'organization.suspended': [],
  'organization.reactivated': [],
  'organization.limits_changed': ['limits'],
  'organization.settings_changed': ['fields', 'require2fa'],
  'organization.ownership_transferred': ['from', 'to'],
  'workspace.created': [],
  'workspace.renamed': [],
  'workspace.archived': [],
  'member.added': ['role'],
  'member.role_changed': ['from', 'to'],
  'member.removed': ['role'],
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOOKS_SECRET = [
  /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i, // email
  /\b\d{1,3}(\.\d{1,3}){3}\b/, // IPv4
  /\b[0-9a-f]{1,4}(:[0-9a-f]{0,4}){2,7}\b/i, // IPv6
  /\$argon2|secret|token_hash|key_enc/i,
]

/** Strings that are neither ids nor words: a token or a hash would look like this. */
function looksLikeToken(value: string): boolean {
  if (UUID.test(value)) return false
  return value.length >= 20 && /^[A-Za-z0-9_+/=.-]+$/.test(value) && /\d/.test(value)
}

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([k, v]) => [k, ...stringsIn(v)])
  return []
}

test('every audit action has the list of keys its data may hold', () => {
  expect(Object.keys(AUDIT_DATA_KEYS).sort()).toEqual([...AUDIT_ACTIONS].sort())
})

test('after the battery, audit data holds only the listed keys and nothing personal', async () => {
  const { rows } = await fx.env.admin.pool.query<{ action: string; data: Record<string, unknown> }>(
    'select action, data from audit_log',
  )
  const recorded = new Set(rows.map((r) => r.action))
  // the battery ran every agency action of the panel
  for (const action of [
    'user.invited',
    'user.disabled',
    'user.role_changed',
    'user.password_reset_link',
    'organization.settings_changed',
    'organization.ownership_transferred',
    'workspace.created',
    'workspace.renamed',
    'workspace.archived',
    'member.added',
    'member.role_changed',
    'member.removed',
  ])
    expect(recorded, action).toContain(action)

  const problems: string[] = []
  for (const { action, data } of rows) {
    const allowed: readonly string[] | undefined = (
      AUDIT_DATA_KEYS as Record<string, readonly string[]>
    )[action]
    if (allowed === undefined) {
      problems.push(`${action}: no list of keys`)
      continue
    }
    for (const key of Object.keys(data))
      if (!allowed.includes(key)) problems.push(`${action}: key ${key} not listed`)
    for (const text of stringsIn(data))
      if (LOOKS_SECRET.some((re) => re.test(text)) || looksLikeToken(text))
        problems.push(`${action}: value ${JSON.stringify(text)} looks personal or secret`)
  }
  expect(problems).toEqual([])

  // and the panel's log answers the same data, nothing more
  const r = await fx.env.call('GET', `/api/v1/orgs/${fx.a.slug}/audit-log?limit=100`, undefined, {
    cookie: fx.cookies.owner,
  })
  expect(r.status).toBe(200)
  const { items } = (await r.json()) as { items: { action: string; data: object }[] }
  expect(items.length).toBeGreaterThan(0)
  for (const item of items)
    for (const key of Object.keys(item.data))
      expect(AUDIT_DATA_KEYS[item.action as AuditAction], `${item.action}.${key}`).toContain(key)
})

// ---------------------------------------------------------------------------------------------

const SECRET_IN_BODY = /"password"|backup_codes|"secret"|token_hash|key_enc|\$argon2|"token"/
// the OpenAPI document names the fields `password` and `token` of the requests it describes
const SECRET_VALUE = /backup_codes|token_hash|key_enc|\$argon2/

test('responses never contain secrets', async () => {
  const ids = await fx.caseIds({ agency: 'a', actorsInWorkspace: true })
  const token = await fx.openLink()
  const gets = apiRoutes.filter((r) => r.method === 'GET')
  expect(gets.length).toBeGreaterThan(0)
  for (const route of gets) {
    const path = fill(route.path, { ...pathValues(ids), token })
    const r = await fx.env.call('GET', path, undefined, { cookie: fx.cookies.owner })
    const body = await r.text()
    expect(r.status, `${path}: ${body}`).toBe(200)
    expect(body, path).not.toMatch(
      route === routeByKey('GET /api/v1/openapi.json') ? SECRET_VALUE : SECRET_IN_BODY,
    )
  }
})

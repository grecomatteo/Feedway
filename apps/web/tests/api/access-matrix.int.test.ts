import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { apiRoutes } from '@app/contracts'
import type { ApiContract } from '@app/contracts'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  AUDIT_ACTIONS,
  SYSTEM_PLATFORM_ACTOR,
  createOrganization,
  disableUserEverywhere,
  enableUserEverywhere,
  lockAccountFromSecurityEmail,
  reactivateOrganization,
  sendAccountLockedNotice,
  setOrganizationLimits,
  suspendOrganization,
} from '@app/application'
import type { AuditAction, JobPayloads, JobQueue } from '@app/application'
import {
  createDb,
  createKeyRing,
  createLogger,
  createMemoryMailer,
  createSignedTokens,
  createTranslate,
  createTokenService,
  createUnitOfWork,
  systemClock,
  uuidV7Generator,
} from '@app/infrastructure'
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
  secretsIn,
  startIsolationFixture,
} from './support/isolation-fixture.js'
import { PASSWORD } from './identity-env.js'
import type { ErrorJson } from './identity-env.js'
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
  /**
   * The case's invite was sent by the Manager: to any other person without `users.manage` it
   * does not exist (404), whatever their role in the workspace.
   */
  sentByManager?: true
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
  // Owner and Admin: every open invite; a Manager: the ones they sent, in workspaces they manage
  'GET /api/v1/orgs/{org}/invites': [
    { permission: 'workspace.members.manage', level: 'organization' },
  ],
  // the case's invite was sent by the Manager into the case's workspace
  'POST /api/v1/orgs/{org}/invites/{inviteId}/resend': [
    { permission: 'workspace.members.manage', level: 'workspace', sentByManager: true },
  ],
  'DELETE /api/v1/orgs/{org}/invites/{inviteId}': [
    { permission: 'workspace.members.manage', level: 'workspace', sentByManager: true },
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
  if (rule.sentByManager && !seesEveryWorkspace && role !== 'manager') return 404
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

/** The code that goes with a refusal: a permission (403) or something not there (404). */
const CODE_OF: Record<number, string> = { 403: 'FORBIDDEN', 404: 'NOT_FOUND' }

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
  const text = await r.text()
  expect(r.status, text).toBe(c.status)
  const code = CODE_OF[c.status]
  if (code !== undefined) expect((JSON.parse(text) as ErrorJson).error.code, text).toBe(code)
  expect(secretsIn(text)).toEqual([])
})

test('an Admin invite: only the Owner sends it again (with a reauth) or cancels it', async () => {
  const route = (key: string) => routeByKey(key)
  const resend = route('POST /api/v1/orgs/{org}/invites/{inviteId}/resend')
  const revoke = route('DELETE /api/v1/orgs/{org}/invites/{inviteId}')
  const ids = await fx.caseIds({ agency: 'a', actorsInWorkspace: true })
  const invite = await fx.adminInvite(ids.workspace)
  const at = (r: ApiContract) => fill(r.path, { ...pathValues(ids), inviteId: invite })
  for (const role of ['admin', 'manager'] as const)
    for (const r of [resend, revoke]) {
      const answer = await fx.env.call(r.method, at(r), undefined, { cookie: fx.cookies[role] })
      expect(answer.status, `${role} ${r.method}`).toBe(role === 'admin' ? 403 : 404)
    }
  const ok = await fx.env.call(resend.method, at(resend), undefined, { cookie: fx.cookies.owner })
  expect(ok.status, await ok.text()).toBe(200)
  // cancelling takes access away: no reauth needed
  await fx.env.admin.pool.query('update sessions set reauthenticated_at = null')
  const gone = await fx.env.call(revoke.method, at(revoke), undefined, { cookie: fx.cookies.owner })
  expect(gone.status, await gone.text()).toBe(200)
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
// Activity log: what `AuditItem.data` may hold, action by action, down to the nested keys
// (`a.b`, `list[].key`). A key not listed, or a value that looks like an email, an address or a
// token, fails; so does an action without a list. The test runs the actions itself, then reads
// every row of the table (agency, personal and platform entries).

const LIMITS = ['workspaces', 'social_accounts', 'users', 'storage_bytes', 'posts_per_day']

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
  'auth.security_lock': ['sessionsClosed', 'tokensRevoked'],
  'auth.security_lock_notified': ['recipients'],
  'auth.recovery_link_sent': ['channel'],
  'session.revoked': ['count'],
  'user.invited': ['orgRole', 'memberships[].workspaceId', 'memberships[].role'],
  'user.invite_resent': [],
  'user.invite_revoked': ['reason'],
  'user.activated': ['purpose', 'role'],
  'user.disabled': ['scope', 'sessionsClosed'],
  'user.identity_verified': ['method'],
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
  'organization.limits_changed': LIMITS.map((k) => `limits.${k}`),
  'organization.settings_changed': ['fields[]', 'require2fa.from', 'require2fa.to'],
  'organization.ownership_transferred': ['from', 'to'],
  'workspace.created': [],
  'workspace.renamed': [],
  'workspace.archived': [],
  'member.added': ['role'],
  'member.role_changed': ['from', 'to'],
  'member.removed': ['role'],
}

/**
 * Not produced in this stage: account pages (Task 23+), second factor setup in the browser,
 * profile, export and anonymization. Their entries are written without data, or with the keys
 * listed above.
 */
const NOT_EXERCISED: readonly AuditAction[] = [
  'auth.second_factor_failed',
  'auth.password_changed',
  'auth.password_reset',
  'auth.email_change_requested',
  'auth.email_changed',
  'auth.totp_enabled',
  'auth.totp_disabled',
  'auth.backup_codes_regenerated',
  'auth.passkey_added',
  'auth.passkey_removed',
  'user.profile_updated',
  'user.avatar_changed',
  'user.data_exported',
  'user.anonymized',
  'user.anonymization_scheduled',
  'user.anonymization_skipped',
]

/** `a`, `a.b`, `a[].b`; an empty list stands as `a[]`. */
function keyPaths(value: unknown, prefix: string): string[] {
  if (Array.isArray(value))
    return value.length === 0 ? [`${prefix}[]`] : value.flatMap((v) => keyPaths(v, `${prefix}[]`))
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return [prefix]
    return entries.flatMap(([k, v]) => keyPaths(v, `${prefix}.${k}`))
  }
  return [prefix]
}

const dataPaths = (data: Record<string, unknown>) =>
  Object.entries(data).flatMap(([k, v]) => keyPaths(v, k))

function pathAllowed(path: string, allowed: readonly string[]): boolean {
  return (
    allowed.includes(path) ||
    // an empty list or object under a listed path
    allowed.some((a) => a.startsWith(`${path}.`) || a.startsWith(`${path}[`))
  )
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

/** Runs every action the panel, the sign-in and the platform can produce in this stage. */
async function produceEveryAction() {
  const { env } = fx
  const { cookie, ids } = await fx.throwawayAgency()
  const org = `/api/v1/orgs/${ids.org}`
  const ok = async (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => {
    await fx.refreshReauth()
    const r = await env.call(method, path, body, { cookie })
    const text = await r.text()
    expect(r.status, `${method} ${path}: ${text}`).toBe(200)
    expect(secretsIn(text)).toEqual([])
    return text
  }
  // agency actions, through the routes
  await ok('PATCH', `${org}/settings`, { name: 'Agenzia del registro', require2fa: 'all' })
  await ok('POST', `${org}/invites`, {
    email: `registro-${randomUUID().slice(0, 8)}@example.test`,
    orgRole: 'member',
    memberships: [{ workspaceId: ids.workspace, role: 'viewer' }],
  })
  await ok('POST', `${org}/invites/${ids.invite}/resend`)
  await ok('DELETE', `${org}/invites/${ids.invite}`)
  await ok('POST', `${org}/members/${ids.target}/password-reset-link`)
  await ok('POST', `${org}/members/${ids.target}/disable`)
  await ok('POST', `${org}/members/${ids.target}/enable`)
  await ok('PUT', `${org}/members/${ids.newcomer}/role`, { role: 'admin' })
  const created = JSON.parse(
    await ok('POST', `${org}/workspaces`, { name: 'Spazio del registro' }),
  ) as { id: string }
  await ok('PATCH', `${org}/workspaces/${created.id}`, { name: 'Spazio rinominato' })
  const members = `${org}/workspaces/${created.id}/members`
  await ok('POST', members, { userId: ids.target, role: 'viewer' })
  await ok('PUT', `${members}/${ids.target}`, { role: 'editor' })
  await ok('DELETE', `${members}/${ids.target}`)
  await ok('POST', `${org}/workspaces/${created.id}/archive`)
  // a real reauth, then the hand-over (it signs the Owner out)
  await env.reauth(cookie)
  await ok('POST', `${org}/ownership-transfer`, { userId: ids.admin })

  // activation, sign-in events and the person's own sessions
  const token = await fx.openLink()
  const activated = await env.call('POST', `/api/v1/links/${encodeURIComponent(token)}/activate`, {
    name: 'Persona Registro',
    password: PASSWORD,
  })
  expect(activated.status).toBe(200)
  const person = await env.person(fx.a.id, 'member')
  const failed = await env.call('POST', '/api/auth/sign-in/email', {
    email: person.email,
    password: 'parola-sbagliata-del-tutto',
  })
  expect(failed.status).toBe(401)
  const first = await env.signIn(person)
  // a second sign-in without the device cookie is a new device
  const second = await env.signIn(person)
  expect((await env.call('POST', '/api/auth/sign-out', {}, { cookie: second })).status).toBe(200)
  const { rows } = await env.admin.pool.query<{ id: string }>(
    'select id from sessions where user_id = $1',
    [person.userId],
  )
  const third = await env.signIn(person)
  expect(
    (
      await env.call('DELETE', `/api/v1/me/sessions/${rows[0]?.id ?? ''}`, undefined, {
        cookie: first,
      })
    ).status,
  ).toBe(200)
  expect(
    (await env.call('DELETE', '/api/v1/me/sessions', undefined, { cookie: third })).status,
  ).toBe(200)

  // the platform's actions, through its use cases (its routes come with a later stage)
  const handle = createDb(env.tdb.runtimeUrl, { max: 2, applicationName: 'matrix-platform' })
  try {
    const uow = createUnitOfWork({
      db: handle.db,
      ids: uuidV7Generator,
      logger: createLogger({ service: 'web', level: 'error' }),
    })
    const queued: { name: string; data: unknown }[] = []
    const queue: JobQueue = {
      send(name, data) {
        queued.push({ name, data })
        return Promise.resolve(null)
      },
      work: () => Promise.reject(new Error('not used')),
      ping: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    }
    const mailer = createMemoryMailer()
    const platform = {
      uow,
      clock: systemClock,
      ids: uuidV7Generator,
      tokens: createTokenService(),
      keyRing: createKeyRing({ platformKey: randomBytes(32), clock: systemClock }),
      config: { panelUrl: 'https://pannello.example.ts.net' },
      queue,
      mailer,
    }
    const actor = SYSTEM_PLATFORM_ACTOR
    const newOrg = await createOrganization(platform, actor, {
      name: 'Agenzia della piattaforma',
      ownerEmail: `titolare-${randomUUID().slice(0, 8)}@example.test`,
    })
    await createOrganization(platform, actor, {
      name: 'Agenzia di chi c’è già',
      ownerEmail: person.email,
    })
    await setOrganizationLimits(platform, actor, newOrg.organizationId, { workspaces: 3, users: 9 })
    await suspendOrganization(platform, actor, newOrg.organizationId)
    await reactivateOrganization(platform, actor, newOrg.organizationId)
    await disableUserEverywhere(platform, actor, person.userId)
    await enableUserEverywhere(platform, actor, person.userId)
    const locked = await env.person(fx.a.id, 'member')
    await env.signIn(locked)
    const signed = createSignedTokens(randomBytes(32))
    await lockAccountFromSecurityEmail(
      { uow, tokens: signed, clock: systemClock, queue },
      {
        token: signed.sign('security_lock', {
          userId: locked.userId,
          issuedAt: new Date(Date.now() - 1000),
          expiresAt: new Date(Date.now() + 60_000),
        }),
        ip: null,
      },
    )
    const notice = queued.find((q) => q.name === 'identity.account_locked_notice')
    await sendAccountLockedNotice(
      {
        uow,
        mailer,
        translate: createTranslate(
          JSON.parse(
            readFileSync(new URL('../../i18n/locales/it.json', import.meta.url), 'utf8'),
          ) as unknown,
        ),
        logger: createLogger({ service: 'web', level: 'error' }),
        panelUrl: new URL('https://pannello.example.ts.net'),
        productName: 'Feedway',
        defaultTimezone: 'Europe/Rome',
      },
      notice?.data as JobPayloads['identity.account_locked_notice'],
    )
    const enabled = await enableUserEverywhere(platform, actor, locked.userId, {
      identityVerification: { method: 'in_person' },
    })
    expect(enabled.recovery).toEqual({ channel: 'email' })
  } finally {
    await handle.close()
  }
}

test('every audit action has the list of keys its data may hold', () => {
  expect(Object.keys(AUDIT_DATA_KEYS).sort()).toEqual([...AUDIT_ACTIONS].sort())
})

test('audit data holds only the listed keys and nothing personal', async () => {
  await produceEveryAction()
  const { rows } = await fx.env.admin.pool.query<{ action: string; data: Record<string, unknown> }>(
    'select action, data from audit_log',
  )
  const recorded = new Set(rows.map((r) => r.action))
  expect(AUDIT_ACTIONS.filter((a) => !NOT_EXERCISED.includes(a) && !recorded.has(a))).toEqual([])
  // with their richest data too
  const enabledKeys = rows
    .filter((r) => r.action === 'user.enabled')
    .flatMap((r) => Object.keys(r.data))
  expect(enabledKeys).toEqual(expect.arrayContaining(['passwordCleared', 'resetLinkIssued']))

  const problems: string[] = []
  for (const { action, data } of rows) {
    const allowed: readonly string[] | undefined = (
      AUDIT_DATA_KEYS as Record<string, readonly string[]>
    )[action]
    if (allowed === undefined) {
      problems.push(`${action}: no list of keys`)
      continue
    }
    for (const path of dataPaths(data))
      if (!pathAllowed(path, allowed)) problems.push(`${action}: key ${path} not listed`)
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
  const { items } = (await r.json()) as {
    items: { action: string; data: Record<string, unknown> }[]
  }
  expect(items.length).toBeGreaterThan(0)
  for (const item of items)
    for (const path of dataPaths(item.data))
      expect(
        pathAllowed(path, AUDIT_DATA_KEYS[item.action as AuditAction]),
        `${item.action}: ${path}`,
      ).toBe(true)
})

// ---------------------------------------------------------------------------------------------

/** The OpenAPI document names the `password` and `token` fields of the requests it describes. */
const OPENAPI_KEYS = ['password', 'token']

test.each(['owner', 'viewer'] as const)('responses never contain secrets, as %s', async (role) => {
  const ids = await fx.caseIds({ agency: 'a', actorsInWorkspace: true })
  const token = await fx.openLink()
  const gets = apiRoutes.filter((r) => r.method === 'GET')
  expect(gets.length).toBeGreaterThan(0)
  for (const route of gets) {
    const path = fill(route.path, { ...pathValues(ids), token })
    const r = await fx.env.call('GET', path, undefined, { cookie: fx.cookies[role] })
    const body = await r.text()
    if (role === 'owner') expect(r.status, `${path}: ${body}`).toBe(200)
    const allowed = routeKey(route) === 'GET /api/v1/openapi.json' ? OPENAPI_KEYS : []
    expect(secretsIn(body, allowed), path).toEqual([])
  }
})

import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import {
  activateAccount,
  changeOrgRole,
  createAuthEventSink,
  createPasswordResetLink,
  describeLink,
  disableMember,
  enableMember,
  inviteUser,
  listMembers,
  resolveOrgActor,
  resolveSessionUser,
  transferOwnership,
  type Auth,
  type AuthSessionInfo,
  type IdentityDeps,
  type JobPayloads,
  type JobQueue,
  type Logger,
  type UnitOfWork,
} from '@app/application'
import type { OrgActor, WorkspaceRole } from '@app/domain'
import { createDb, type Db } from '../db/client.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createKeyRing } from '../crypto/key-ring.js'
import { createPasswordHasher } from '../crypto/password-hasher.js'
import { passwordStrength } from '../crypto/password-strength.js'
import { createSignedTokens } from '../crypto/signed-tokens.js'
import { createTokenService } from '../crypto/tokens.js'
import { createPgRateLimiter } from '../db/rate-limiter.js'
import { createLogger } from '../logging/logger.js'
import { systemClock } from '../system/clock.js'
import { uuidV7Generator } from '../system/id-generator.js'
import {
  fixedClock,
  seed,
  startTestDatabase,
  withScope,
  type TestDatabase,
} from '../testing/index.js'
import { createAuthAdapter } from './auth-adapter.js'
import { createBetterAuth, type BetterAuthInstance } from './better-auth.js'

const PANEL = 'https://app.feedway.test'
// low entropy on purpose: made-up values, not secrets for the leak scanner
const PASSWORD = 'cavallo-batteria-graffetta-lago'
const NEW_PASSWORD = 'tramonto-ombrello-giraffa-canale'
const OTHER_PASSWORD = 'sentiero-lampone-violino-faro'
const REQ = { ip: '93.41.12.200' }
const APP_NAME = 'members-test'

let tdb: TestDatabase
let admin: pg.Client
let instance: BetterAuthInstance
let auth: Auth
let uow: UnitOfWork
let deps: IdentityDeps
const tokens = createTokenService()
const logger = createLogger({ service: 'web', level: 'error' })
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

let db: Db

function buildAuth(withQueue: Pick<JobQueue, 'send'>, withLogger: Logger): BetterAuthInstance {
  const secret = randomBytes(32).toString('hex')
  return createBetterAuth({
    db,
    config: {
      panelUrl: PANEL,
      productName: 'Feedway',
      secret,
      secrets: [{ version: 1, value: secret }],
    },
    ids: uuidV7Generator,
    clock: systemClock,
    hasher: createPasswordHasher(),
    rateLimiter: createPgRateLimiter({ db, clock: systemClock }),
    logger: withLogger,
    queue: withQueue,
    events: createAuthEventSink({
      uow,
      queue,
      tokens: createSignedTokens(randomBytes(32)),
      clock: systemClock,
      logger,
    }),
    resolveSessionUser: (session) =>
      resolveSessionUser({ uow, config: { require2fa: 'admins' } }, session),
  })
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  db = createDb(tdb.runtimeUrl, { max: 6, applicationName: APP_NAME }).db
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  uow = createUnitOfWork({ db, ids: uuidV7Generator, logger })
  const rateLimiter = createPgRateLimiter({ db, clock: systemClock })
  instance = buildAuth(queue, logger)
  auth = createAuthAdapter(instance, { db, clock: systemClock })
  deps = {
    uow,
    clock: systemClock,
    ids: uuidV7Generator,
    auth,
    tokens,
    keyRing: createKeyRing({ platformKey: randomBytes(32), clock: systemClock }),
    passwordStrength,
    rateLimiter,
    config: {
      bootstrapOwnerEmail: null,
      bootstrapOrganizationName: '',
      require2fa: 'admins',
      panelUrl: PANEL,
    },
  }
})
afterAll(async () => {
  await admin.end()
  await tdb.stop()
})
beforeEach(() => {
  queued.length = 0
})

const tokenOf = (url: string) => decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '')
const uniqueEmail = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@esempio.it`
const randomIp = () =>
  `10.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250))}.1`

/** A person with a password; no memberships. */
async function person(prefix = 'persona') {
  const id = randomUUID()
  const email = uniqueEmail(prefix)
  await auth.createUser({ id, email, name: 'Anna Rossi', password: PASSWORD })
  return { id, email }
}

/** Agency A (two workspaces) and agency B, with the people the tests act as or on. */
async function world() {
  const { orgA, w1, w2, orgB, wB } = await seed(tdb.runtimeUrl, async (s) => {
    const orgA = await s.organization()
    const orgB = await s.organization()
    return {
      orgA,
      orgB,
      w1: await s.workspace(orgA),
      w2: await s.workspace(orgA),
      wB: await s.workspace(orgB),
    }
  })
  const owner = await person('titolare')
  const adminA = await person('admin')
  const manager = await person('manager')
  const member = await person('membro')
  const both = await person('entrambe')
  const ownerB = await person('titolareb')
  await seed(tdb.runtimeUrl, async (s) => {
    await s.member(orgA, owner.id, 'owner')
    await s.member(orgA, adminA.id, 'admin')
    await s.member(orgA, manager.id, 'member')
    await s.workspaceMember(orgA, w1, manager.id, 'manager')
    await s.member(orgA, member.id, 'member')
    await s.workspaceMember(orgA, w1, member.id, 'viewer')
    await s.member(orgA, both.id, 'member')
    await s.member(orgB, both.id, 'member')
    await s.member(orgB, ownerB.id, 'owner')
  })
  return { orgA, w1, w2, orgB, wB, owner, adminA, manager, member, both, ownerB }
}

/** Seed slugs are the agency ids. */
const actorOf = (userId: string, organizationId: string): Promise<OrgActor> =>
  resolveOrgActor(deps, { userId, organizationSlug: organizationId })

function sessionOf(userId: string, reauthenticatedAt: Date | null): AuthSessionInfo {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + 3600_000),
    ipAddress: null,
    userAgent: null,
    authMethod: 'passkey',
    reauthenticatedAt,
  }
}
const fresh = (actor: OrgActor) => sessionOf(actor.userId, new Date())
const stale = (actor: OrgActor) => sessionOf(actor.userId, null)

const invite = (workspaceId: string, role: WorkspaceRole, email = uniqueEmail('invitato')) => ({
  email,
  orgRole: 'member' as const,
  memberships: [{ workspaceId, role }],
})

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return instance.handler(
    new Request(`${PANEL}/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: PANEL,
        'x-app-client-ip': randomIp(),
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
}
const signIn = (email: string, password = PASSWORD) => post('/sign-in/email', { email, password })
async function signedInCookie(email: string, password = PASSWORD): Promise<string> {
  const res = await signIn(email, password)
  expect(res.status).toBe(200)
  return cookieOf(res)
}
const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')

async function activeSessionsOf(userId: string) {
  const { rows } = await admin.query<{ id: string }>('select id from sessions where user_id = $1', [
    userId,
  ])
  return rows
}
async function orgRoleOf(organizationId: string, userId: string) {
  const { rows } = await admin.query<{ role: string; status: string }>(
    'select role, status from organization_members where organization_id = $1 and user_id = $2',
    [organizationId, userId],
  )
  return rows[0]?.role
}
async function lastAudit(organizationId: string) {
  const { rows } = await admin.query<{
    action: string
    organization_id: string | null
    actor_id: string
    entity_id: string | null
    data: Record<string, unknown> | null
    ip: string | null
  }>(
    `select action, organization_id, actor_id, entity_id, data, host(ip) as ip from audit_log
      where organization_id = $1 order by created_at desc, id desc limit 1`,
    [organizationId],
  )
  return rows[0]
}
/** Limits change only in the system scope (a trigger guards them). */
async function setLimits(organizationId: string, limits: Record<string, unknown>) {
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query('update organizations set limits = $2 where id = $1', [organizationId, limits]),
  )
}
/** Waits until `n` of our pooled connections are blocked on a lock. */
async function waitForWaiters(n: number) {
  const deadline = Date.now() + 10_000
  for (;;) {
    const { rows } = await admin.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
        where application_name = $1 and wait_event_type = 'Lock'`,
      [APP_NAME],
    )
    if ((rows[0]?.n ?? 0) >= n) return
    if (Date.now() > deadline) throw new Error('the invites never waited on the seat lock')
    await new Promise((r) => setTimeout(r, 20))
  }
}
async function auditCount(organizationId: string) {
  const { rows } = await admin.query<{ n: number }>(
    'select count(*)::int as n from audit_log where organization_id = $1',
    [organizationId],
  )
  return rows[0]?.n ?? 0
}
async function addPasskeyDirectly(userId: string) {
  await admin.query(
    `insert into passkeys (id, public_key, user_id, credential_id, counter, device_type, backed_up)
     values ($1, 'chiave', $2, $3, 0, 'singleDevice', false)`,
    [randomUUID(), userId, randomUUID()],
  )
}

describe('invites', () => {
  test('manager invites a publisher to own workspace', async () => {
    const w = await world()
    const manager = await actorOf(w.manager.id, w.orgA)
    const before = Date.now()
    const r = await inviteUser(deps, manager, fresh(manager), invite(w.w1, 'publisher'), REQ)
    expect(r.url).toMatch(/^https:\/\/app\.feedway\.test\/attiva\//)
    expect(r.expiresAt.getTime() - before).toBeGreaterThanOrEqual(72 * 3600_000 - 1000)
    expect(r.expiresAt.getTime() - before).toBeLessThanOrEqual(72 * 3600_000 + 60_000)
    const entry = await lastAudit(w.orgA)
    expect(entry).toMatchObject({ action: 'user.invited', actor_id: w.manager.id, ip: REQ.ip })
    // never the invited email, nor whether it has an account elsewhere
    expect(JSON.stringify(entry?.data)).not.toContain('@')
    expect(entry?.data).not.toHaveProperty('existingUser')
  })

  test('manager cannot invite a manager or into another workspace', async () => {
    const w = await world()
    const manager = await actorOf(w.manager.id, w.orgA)
    await expect(
      inviteUser(deps, manager, fresh(manager), invite(w.w1, 'manager'), REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      inviteUser(deps, manager, fresh(manager), invite(w.w2, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  test('a viewer cannot invite into their own workspace', async () => {
    const w = await world()
    const viewer = await actorOf(w.member.id, w.orgA)
    await expect(
      inviteUser(deps, viewer, fresh(viewer), invite(w.w1, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  test('only owner and admin can invite a member without workspaces', async () => {
    const w = await world()
    const noSpaces = {
      email: uniqueEmail('amministrazione'),
      orgRole: 'member' as const,
      memberships: [],
    }
    const manager = await actorOf(w.manager.id, w.orgA)
    await expect(inviteUser(deps, manager, fresh(manager), noSpaces, REQ)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const adminA = await actorOf(w.adminA.id, w.orgA)
    await expect(inviteUser(deps, adminA, fresh(adminA), noSpaces, REQ)).resolves.toMatchObject({
      url: expect.any(String) as string,
    })
  })

  test('workspace of another organization is not found', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await expect(
      inviteUser(deps, owner, fresh(owner), invite(w.wB, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  test('admin cannot invite an admin; the owner can, after a reauth', async () => {
    const w = await world()
    const adminA = await actorOf(w.adminA.id, w.orgA)
    const asAdmin = { ...invite(w.w1, 'viewer'), orgRole: 'admin' as const }
    await expect(inviteUser(deps, adminA, fresh(adminA), asAdmin, REQ)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const owner = await actorOf(w.owner.id, w.orgA)
    await expect(inviteUser(deps, owner, stale(owner), asAdmin, REQ)).rejects.toMatchObject({
      code: 'REAUTH_REQUIRED',
    })
    await expect(inviteUser(deps, owner, fresh(owner), asAdmin, REQ)).resolves.toMatchObject({
      url: expect.any(String) as string,
    })
  })

  test('someone already in the agency is not invited again', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await expect(
      inviteUser(
        deps,
        owner,
        fresh(owner),
        invite(w.w1, 'viewer', ` ${w.member.email.toUpperCase()} `),
        REQ,
      ),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'È già nell’agenzia: aggiungilo allo spazio',
    })
  })

  test('a malformed email or a repeated workspace is refused', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await expect(
      inviteUser(deps, owner, fresh(owner), invite(w.w1, 'viewer', 'non-una-email'), REQ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(
      inviteUser(
        deps,
        owner,
        fresh(owner),
        {
          email: uniqueEmail('doppio'),
          orgRole: 'member',
          memberships: [
            { workspaceId: w.w1, role: 'viewer' },
            { workspaceId: w.w1, role: 'editor' },
          ],
        },
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  test('user already in another agency joins with the same identity', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    const userOfB = await person('utenteb')
    await seed(tdb.runtimeUrl, (s) => s.member(w.orgB, userOfB.id, 'member'))
    const { url } = await inviteUser(
      deps,
      owner,
      fresh(owner),
      invite(w.w1, 'viewer', `  ${userOfB.email.toUpperCase()} `),
      REQ,
    )
    expect(await describeLink(deps, { token: tokenOf(url) })).toMatchObject({
      existingUser: true,
      email: userOfB.email,
    })
    // the link alone does not hand the membership to whoever holds it
    await expect(
      activateAccount(deps, {
        token: tokenOf(url),
        name: 'Altro',
        nickname: null,
        password: NEW_PASSWORD,
        ip: null,
        userAgent: null,
        sessionUserId: null,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    await activateAccount(deps, {
      token: tokenOf(url),
      name: 'Ignorato',
      nickname: null,
      password: null,
      ip: null,
      userAgent: null,
      sessionUserId: userOfB.id,
    })
    const users = await admin.query('select id from users where email = $1', [userOfB.email])
    expect(users.rowCount).toBe(1)
    const orgs = await admin.query<{ organization_id: string }>(
      'select organization_id from organization_members where user_id = $1',
      [userOfB.id],
    )
    expect(orgs.rows.map((r) => r.organization_id).sort()).toEqual([w.orgA, w.orgB].sort())
    // the credentials did not change
    expect((await signIn(userOfB.email)).status).toBe(200)
  })

  test('invite expires after 72 hours', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    const clock = fixedClock(new Date())
    const { url } = await inviteUser(
      { ...deps, clock },
      owner,
      fresh(owner),
      invite(w.w1, 'viewer'),
      REQ,
    )
    clock.advance(72 * 3600_000 - 60_000)
    await expect(describeLink({ ...deps, clock }, { token: tokenOf(url) })).resolves.toBeDefined()
    clock.advance(2 * 60_000)
    await expect(describeLink({ ...deps, clock }, { token: tokenOf(url) })).rejects.toMatchObject({
      code: 'LINK_INVALID',
    })
  })

  test('user limit is enforced, and an open invite holds a seat', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    // owner, admin, manager, member, both
    await setLimits(w.orgA, { users: 5 })
    await expect(
      inviteUser(deps, owner, fresh(owner), invite(w.w1, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'LIMIT_REACHED' })
    await setLimits(w.orgA, { users: 6 })
    await inviteUser(deps, owner, fresh(owner), invite(w.w1, 'viewer'), REQ)
    await expect(
      inviteUser(deps, owner, fresh(owner), invite(w.w1, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'LIMIT_REACHED' })
    // an unreadable limit closes
    await setLimits(w.orgA, { users: 'tanti' })
    await expect(
      inviteUser(deps, owner, fresh(owner), invite(w.w1, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'LIMIT_REACHED' })
  })

  test('two invites at once cannot both take the last seat', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await setLimits(w.orgA, { users: 6 })
    // hold the agency's seat lock, so both invites are proven to wait on it
    const holder = new pg.Client({ connectionString: tdb.adminUrl })
    await holder.connect()
    await holder.query('begin')
    await holder.query('select pg_advisory_xact_lock(hashtext($1))', [`seats:${w.orgA}`])
    const pending = Promise.allSettled([
      inviteUser(deps, owner, fresh(owner), invite(w.w1, 'viewer'), REQ),
      inviteUser(deps, owner, fresh(owner), invite(w.w1, 'viewer'), REQ),
    ])
    await waitForWaiters(2)
    await holder.query('commit')
    await holder.end()
    const results = await pending
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'LIMIT_REACHED' },
    })
  })

  test('disabled members still take a seat', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await admin.query(
      "update organization_members set status = 'disabled' where organization_id = $1 and user_id = $2",
      [w.orgA, w.member.id],
    )
    await setLimits(w.orgA, { users: 5 })
    await expect(
      inviteUser(deps, owner, fresh(owner), invite(w.w1, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'LIMIT_REACHED' })
  })

  test('a disabled member is not invited again but reactivated', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await admin.query(
      "update organization_members set status = 'disabled' where organization_id = $1 and user_id = $2",
      [w.orgA, w.member.id],
    )
    await expect(
      inviteUser(deps, owner, fresh(owner), invite(w.w1, 'viewer', w.member.email), REQ),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'È nell’agenzia ma disattivato: riattivalo',
    })
  })

  test('an archived workspace takes no invites', async () => {
    const w = await world()
    const archived = await seed(tdb.runtimeUrl, (s) => s.workspace(w.orgA, { archived: true }))
    const owner = await actorOf(w.owner.id, w.orgA)
    await expect(
      inviteUser(deps, owner, fresh(owner), invite(archived, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  test('roles and workspace ids are checked at run time, not only by the types', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    const asOwner = { ...invite(w.w1, 'viewer'), orgRole: 'owner' as unknown as 'admin' }
    await expect(inviteUser(deps, owner, fresh(owner), asOwner, REQ)).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    await expect(
      inviteUser(deps, owner, fresh(owner), invite('non-un-uuid', 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const badRole = invite(w.w1, 'capo' as WorkspaceRole)
    await expect(inviteUser(deps, owner, fresh(owner), badRole, REQ)).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  })

  test('the session must be the actor’s', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await expect(
      inviteUser(deps, owner, sessionOf(w.adminA.id, new Date()), invite(w.w1, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })
})

describe('members', () => {
  test('owner cannot be disabled or demoted by anyone in the organization', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    const adminA = await actorOf(w.adminA.id, w.orgA)
    await expect(disableMember(deps, owner, fresh(owner), w.owner.id, REQ)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(disableMember(deps, adminA, fresh(adminA), w.owner.id, REQ)).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    )
    await expect(
      changeOrgRole(deps, owner, fresh(owner), w.owner.id, 'admin', REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await orgRoleOf(w.orgA, w.owner.id)).toBe('owner')
  })

  test('an admin cannot disable another admin; a member cannot disable anyone', async () => {
    const w = await world()
    const other = await person('admin2')
    await seed(tdb.runtimeUrl, (s) => s.member(w.orgA, other.id, 'admin'))
    const adminA = await actorOf(w.adminA.id, w.orgA)
    await expect(disableMember(deps, adminA, fresh(adminA), other.id, REQ)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const manager = await actorOf(w.manager.id, w.orgA)
    await expect(
      disableMember(deps, manager, fresh(manager), w.member.id, REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  test('someone of another agency is not found', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await expect(disableMember(deps, owner, fresh(owner), w.ownerB.id, REQ)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(
      disableMember(deps, owner, fresh(owner), 'non-un-uuid', REQ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  test('disabling in A keeps access to B and closes the sessions', async () => {
    const w = await world()
    await signedInCookie(w.both.email)
    const adminA = await actorOf(w.adminA.id, w.orgA)
    await disableMember(deps, adminA, fresh(adminA), w.both.id, REQ)
    expect(await activeSessionsOf(w.both.id)).toHaveLength(0)
    await expect(actorOf(w.both.id, w.orgA)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(actorOf(w.both.id, w.orgB)).resolves.toBeDefined()
    expect(await lastAudit(w.orgA)).toMatchObject({
      action: 'user.disabled',
      entity_id: w.both.id,
      actor_id: w.adminA.id,
    })
    // the person can still sign in and work in B
    expect((await signIn(w.both.email)).status).toBe(200)

    // giving access back needs a recent reauth: a stolen session must not reopen an account
    await expect(enableMember(deps, adminA, stale(adminA), w.both.id, REQ)).rejects.toMatchObject({
      code: 'REAUTH_REQUIRED',
    })
    await enableMember(deps, adminA, fresh(adminA), w.both.id, REQ)
    await expect(actorOf(w.both.id, w.orgA)).resolves.toMatchObject({ orgRole: 'member' })
    expect(await lastAudit(w.orgA)).toMatchObject({ action: 'user.enabled', entity_id: w.both.id })
  })

  test('role change requires reauth, only the owner, and revokes sessions', async () => {
    const w = await world()
    await signedInCookie(w.member.email)
    const owner = await actorOf(w.owner.id, w.orgA)
    const adminA = await actorOf(w.adminA.id, w.orgA)
    await expect(
      changeOrgRole(deps, owner, stale(owner), w.member.id, 'admin', REQ),
    ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' })
    await expect(
      changeOrgRole(deps, adminA, fresh(adminA), w.member.id, 'admin', REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await activeSessionsOf(w.member.id)).toHaveLength(1)
    await changeOrgRole(deps, owner, fresh(owner), w.member.id, 'admin', REQ)
    expect(await activeSessionsOf(w.member.id)).toHaveLength(0)
    expect(await orgRoleOf(w.orgA, w.member.id)).toBe('admin')
    expect(await lastAudit(w.orgA)).toMatchObject({
      action: 'user.role_changed',
      entity_id: w.member.id,
      data: { from: 'member', to: 'admin' },
    })
  })

  test('member list never exposes secrets and shows only this agency', async () => {
    const w = await world()
    await addPasskeyDirectly(w.adminA.id)
    const owner = await actorOf(w.owner.id, w.orgA)
    const list = await listMembers(deps, owner)
    const json = JSON.stringify(list)
    for (const k of ['password', 'secret', 'token', 'hash', 'publicKey', 'credential'])
      expect(json).not.toContain(k)
    expect(list.map((m) => m.id).sort()).toEqual(
      [w.owner.id, w.adminA.id, w.manager.id, w.member.id, w.both.id].sort(),
    )
    expect(list.find((m) => m.id === w.manager.id)).toEqual({
      id: w.manager.id,
      displayName: 'Anna Rossi',
      name: 'Anna Rossi',
      nickname: null,
      email: w.manager.email,
      avatarUrl: null,
      orgRole: 'member',
      status: 'active',
      secondFactorConfigured: false,
      workspaces: [{ id: w.w1, name: expect.any(String) as string, role: 'manager' }],
      lastLoginAt: null,
    })
    expect(list.find((m) => m.id === w.adminA.id)?.secondFactorConfigured).toBe(true)
    const manager = await actorOf(w.manager.id, w.orgA)
    await expect(listMembers(deps, manager)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('ownership', () => {
  test('owner transfers ownership to an active admin and becomes admin', async () => {
    const w = await world()
    await addPasskeyDirectly(w.adminA.id)
    await signedInCookie(w.adminA.email)
    await signedInCookie(w.owner.email)
    const owner = await actorOf(w.owner.id, w.orgA)
    const adminA = await actorOf(w.adminA.id, w.orgA)
    await expect(
      transferOwnership(deps, owner, fresh(owner), w.member.id, REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      transferOwnership(deps, adminA, fresh(adminA), w.adminA.id, REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      transferOwnership(deps, owner, stale(owner), w.adminA.id, REQ),
    ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' })
    await transferOwnership(deps, owner, fresh(owner), w.adminA.id, REQ)
    expect(await orgRoleOf(w.orgA, w.adminA.id)).toBe('owner')
    expect(await orgRoleOf(w.orgA, w.owner.id)).toBe('admin')
    expect(await lastAudit(w.orgA)).toMatchObject({
      action: 'organization.ownership_transferred',
      organization_id: w.orgA,
      data: { from: w.owner.id, to: w.adminA.id },
    })
    expect(await activeSessionsOf(w.adminA.id)).toHaveLength(0)
    expect(await activeSessionsOf(w.owner.id)).toHaveLength(0)
  })

  test('ownership transfer is atomic', async () => {
    const w = await world()
    await addPasskeyDirectly(w.adminA.id)
    const owner = await actorOf(w.owner.id, w.orgA)
    const failingAfterDemotion: IdentityDeps = {
      ...deps,
      uow: {
        run: (scope, fn) =>
          uow.run(scope, (tx) =>
            fn({
              ...tx,
              orgMembers: {
                ...tx.orgMembers,
                setRole: (organizationId, userId, from, to) =>
                  to === 'owner'
                    ? Promise.reject(new Error('processo interrotto'))
                    : tx.orgMembers.setRole(organizationId, userId, from, to),
              },
            }),
          ),
        runAsSystem: (reason, fn) => uow.runAsSystem(reason, fn),
      },
    }
    await expect(
      transferOwnership(failingAfterDemotion, owner, fresh(owner), w.adminA.id, REQ),
    ).rejects.toThrow('processo interrotto')
    expect(await orgRoleOf(w.orgA, w.owner.id)).toBe('owner')
    expect(await orgRoleOf(w.orgA, w.adminA.id)).toBe('admin')
    const owners = await admin.query(
      "select 1 from organization_members where organization_id = $1 and role = 'owner'",
      [w.orgA],
    )
    expect(owners.rowCount).toBe(1)
  })

  test('ownership goes only to an active admin with a second factor', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await expect(
      transferOwnership(deps, owner, fresh(owner), w.adminA.id, REQ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    const disabledAdmin = await person('admin-spento')
    await addPasskeyDirectly(disabledAdmin.id)
    await seed(tdb.runtimeUrl, (s) => s.member(w.orgA, disabledAdmin.id, 'admin', 'disabled'))
    await expect(
      transferOwnership(deps, owner, fresh(owner), disabledAdmin.id, REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      transferOwnership(deps, owner, fresh(owner), w.ownerB.id, REQ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('password reset', () => {
  test('admin cannot create a reset link for a user who also works for another agency', async () => {
    const w = await world()
    const adminA = await actorOf(w.adminA.id, w.orgA)
    // memberships in other agencies are not visible under A's row level security
    await expect(
      createPasswordResetLink(deps, adminA, fresh(adminA), w.both.id, REQ),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Questo utente lavora anche con altre agenzie: può reimpostare la password da solo',
    })
    // a disabled membership elsewhere still counts
    await admin.query(
      "update organization_members set status = 'disabled' where organization_id = $1 and user_id = $2",
      [w.orgB, w.both.id],
    )
    await expect(
      createPasswordResetLink(deps, adminA, fresh(adminA), w.both.id, REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      createPasswordResetLink(deps, adminA, fresh(adminA), w.member.id, REQ),
    ).resolves.toMatchObject({
      url: expect.stringContaining('/api/auth/reset-password/') as string,
    })
    expect(await lastAudit(w.orgA)).toMatchObject({
      action: 'user.password_reset_link',
      entity_id: w.member.id,
      actor_id: w.adminA.id,
    })
    // a copied link is not mailed
    expect(queued.filter((j) => j.name === 'identity.password_reset_email')).toEqual([])
  })

  test('reset links need a reauth, never target the owner from an admin, nor another agency', async () => {
    const w = await world()
    const adminA = await actorOf(w.adminA.id, w.orgA)
    const manager = await actorOf(w.manager.id, w.orgA)
    await expect(
      createPasswordResetLink(deps, adminA, stale(adminA), w.member.id, REQ),
    ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' })
    await expect(
      createPasswordResetLink(deps, adminA, fresh(adminA), w.owner.id, REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      createPasswordResetLink(deps, manager, fresh(manager), w.member.id, REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      createPasswordResetLink(deps, adminA, fresh(adminA), w.ownerB.id, REQ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  test('copied reset link works once, closes all sessions and the old password stops working', async () => {
    const w = await world()
    await signedInCookie(w.member.email)
    await signedInCookie(w.member.email)
    const owner = await actorOf(w.owner.id, w.orgA)
    const { url } = await createPasswordResetLink(deps, owner, fresh(owner), w.member.id, REQ)
    // the link opens the panel's reset page with the token
    const opened = await instance.handler(
      new Request(url, { headers: { 'x-app-client-ip': randomIp() } }),
    )
    expect(opened.status).toBe(302)
    const page = new URL(opened.headers.get('location') ?? '')
    expect(page.pathname).toBe('/reimposta')
    const token = page.searchParams.get('token') ?? ''

    expect((await post('/reset-password', { token, newPassword: NEW_PASSWORD })).status).toBe(200)
    expect(await activeSessionsOf(w.member.id)).toHaveLength(0)
    expect((await signIn(w.member.email)).status).not.toBe(200)
    expect((await signIn(w.member.email, NEW_PASSWORD)).status).toBe(200)
    expect((await post('/reset-password', { token, newPassword: OTHER_PASSWORD })).status).not.toBe(
      200,
    )
    const events = await admin.query<{ action: string }>(
      'select action from audit_log where actor_id = $1 and organization_id is null',
      [w.member.id],
    )
    expect(events.rows.map((r) => r.action)).toContain('auth.password_reset')
  })

  test('someone stuck halfway through a passkey activation gets back in with a reset link', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    const email = uniqueEmail('a-meta')
    const { url } = await inviteUser(deps, owner, fresh(owner), invite(w.w1, 'editor', email), REQ)
    // passkey path: the account exists without a password, no passkey was ever registered
    await activateAccount(deps, {
      token: tokenOf(url),
      name: 'Persona Bloccata',
      nickname: null,
      password: null,
      ip: null,
      userAgent: null,
      sessionUserId: null,
    })
    const { rows } = await admin.query<{ id: string }>('select id from users where email = $1', [
      email,
    ])
    const stuck = rows[0]?.id ?? ''
    const link = await createPasswordResetLink(deps, owner, fresh(owner), stuck, REQ)
    const token = new URL(link.url).pathname.split('/').at(-1) ?? ''
    expect((await post('/reset-password', { token, newPassword: NEW_PASSWORD })).status).toBe(200)
    expect((await signIn(email, NEW_PASSWORD)).status).toBe(200)
  })

  test('forgot password answers the same for known and unknown emails', async () => {
    const w = await world()
    const ask = (email: string) =>
      post('/request-password-reset', { email, redirectTo: '/reimposta' })
    const a = await ask(w.member.email)
    const b = await ask('nessuno@esempio.it')
    expect(a.status).toBe(200)
    expect(a.status).toBe(b.status)
    expect(await a.text()).toBe(await b.text())
    const jobs = queued.filter((j) => j.name === 'identity.password_reset_email')
    expect(jobs).toHaveLength(1)
    const data = jobs[0]?.data as JobPayloads['identity.password_reset_email']
    expect(data.userId).toBe(w.member.id)
    expect(data.url).toContain('/api/auth/reset-password/')
  })

  test('a weak new password is refused on reset, also when it is just the email', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    const { url } = await createPasswordResetLink(deps, owner, fresh(owner), w.member.id, REQ)
    const token = new URL(url).pathname.split('/').at(-1) ?? ''
    expect((await post('/reset-password', { token, newPassword: 'passwordpassword' })).status).toBe(
      422,
    )
    expect((await post('/reset-password', { token, newPassword: w.member.email })).status).toBe(422)
    expect((await post('/reset-password', { token, newPassword: NEW_PASSWORD })).status).toBe(200)
  })
})

describe('change password', () => {
  test('changing the password always signs out the other devices', async () => {
    const p = await person('cambio')
    const here = await signedInCookie(p.email)
    await signedInCookie(p.email)
    expect(await activeSessionsOf(p.id)).toHaveLength(2)
    const res = await post(
      '/change-password',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: false },
      { cookie: here },
    )
    expect(res.status).toBe(200)
    // only the new session of this device is left, with a new cookie
    expect(await activeSessionsOf(p.id)).toHaveLength(1)
    const renewed = cookieOf(res)
    expect(renewed).toContain('__Host-session=')
    expect(await auth.getSession(new Headers({ cookie: renewed }))).not.toBeNull()
    expect(await auth.getSession(new Headers({ cookie: here }))).toBeNull()
  })

  test('a weak new password is still refused', async () => {
    const p = await person('cambio-debole')
    const here = await signedInCookie(p.email)
    const res = await post(
      '/change-password',
      { currentPassword: PASSWORD, newPassword: 'passwordpassword' },
      { cookie: here },
    )
    expect(res.status).toBe(422)
  })
})

describe('review follow-ups', () => {
  test('a repeated disable writes nothing and leaves the other agencies alone', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await disableMember(deps, owner, fresh(owner), w.both.id, REQ)
    const entries = await auditCount(w.orgA)
    // signed in again for agency B: sessions are not per agency
    await signedInCookie(w.both.email)
    await disableMember(deps, owner, fresh(owner), w.both.id, REQ)
    expect(await auditCount(w.orgA)).toBe(entries)
    expect(await activeSessionsOf(w.both.id)).toHaveLength(1)
  })

  test('a role change on a disabled member is a conflict, and the role is checked at run time', async () => {
    const w = await world()
    await admin.query(
      "update organization_members set status = 'disabled' where organization_id = $1 and user_id = $2",
      [w.orgA, w.member.id],
    )
    const owner = await actorOf(w.owner.id, w.orgA)
    await expect(
      changeOrgRole(deps, owner, fresh(owner), w.member.id, 'admin', REQ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      changeOrgRole(deps, owner, fresh(owner), w.manager.id, 'owner' as unknown as 'admin', REQ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(await orgRoleOf(w.orgA, w.manager.id)).toBe('member')
  })

  test('the list shows disabled memberships and anonymized accounts as disabled', async () => {
    const w = await world()
    await admin.query(
      "update organization_members set status = 'disabled' where organization_id = $1 and user_id = $2",
      [w.orgA, w.member.id],
    )
    await admin.query('update users set anonymized_at = now() where id = $1', [w.manager.id])
    const owner = await actorOf(w.owner.id, w.orgA)
    const list = await listMembers(deps, owner)
    expect(list.find((m) => m.id === w.member.id)?.status).toBe('disabled')
    expect(list.find((m) => m.id === w.manager.id)?.status).toBe('disabled')
    expect(list.find((m) => m.id === w.adminA.id)?.status).toBe('active')
  })

  test('ownership never goes to an admin whose account is disabled on the platform', async () => {
    const w = await world()
    await addPasskeyDirectly(w.adminA.id)
    await admin.query("update users set status = 'disabled' where id = $1", [w.adminA.id])
    const owner = await actorOf(w.owner.id, w.orgA)
    await expect(
      transferOwnership(deps, owner, fresh(owner), w.adminA.id, REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await orgRoleOf(w.orgA, w.owner.id)).toBe('owner')
  })

  test('reset links: not for another admin, a disabled membership, an inactive account or a platform admin', async () => {
    const w = await world()
    const other = await person('admin2')
    await seed(tdb.runtimeUrl, (s) => s.member(w.orgA, other.id, 'admin'))
    const adminA = await actorOf(w.adminA.id, w.orgA)
    await expect(
      createPasswordResetLink(deps, adminA, fresh(adminA), other.id, REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const owner = await actorOf(w.owner.id, w.orgA)
    await admin.query(
      "update organization_members set status = 'disabled' where organization_id = $1 and user_id = $2",
      [w.orgA, w.member.id],
    )
    await expect(
      createPasswordResetLink(deps, owner, fresh(owner), w.member.id, REQ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await admin.query("update users set status = 'disabled' where id = $1", [w.manager.id])
    await expect(
      createPasswordResetLink(deps, owner, fresh(owner), w.manager.id, REQ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    // the platform administrator's identity is never in an agency's hands
    await admin.query("update users set platform_role = 'admin' where id = $1", [other.id])
    await expect(
      createPasswordResetLink(deps, owner, fresh(owner), other.id, REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  test('a copied reset link stops working once the person also joins another agency', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    const { url } = await createPasswordResetLink(deps, owner, fresh(owner), w.member.id, REQ)
    const token = tokenOf(url)
    await seed(tdb.runtimeUrl, (s) => s.member(w.orgB, w.member.id, 'member'))
    const res = await post('/reset-password', { token, newPassword: NEW_PASSWORD })
    expect(res.status).toBe(403)
    expect((await signIn(w.member.email)).status).toBe(200)
  })

  test('forgot password still works for someone in several agencies', async () => {
    const w = await world()
    await post('/request-password-reset', { email: w.both.email, redirectTo: '/reimposta' })
    const job = queued.find((j) => j.name === 'identity.password_reset_email')
    const url = (job?.data as JobPayloads['identity.password_reset_email']).url
    const res = await post('/reset-password', { token: tokenOf(url), newPassword: NEW_PASSWORD })
    expect(res.status).toBe(200)
  })

  test('a queue failure answers forgot password like any other email, without logging the link', async () => {
    const w = await world()
    const errors: string[] = []
    const quiet = createLogger({ service: 'web', level: 'error' })
    const capturing: Logger = {
      ...quiet,
      error(fields, message) {
        errors.push(`${message ?? ''} ${JSON.stringify(fields)}`)
      },
    }
    const broken = buildAuth(
      { send: () => Promise.reject(new Error('coda irraggiungibile')) },
      capturing,
    )
    const ask = (email: string) =>
      broken.handler(
        new Request(`${PANEL}/api/auth/request-password-reset`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: PANEL,
            'x-app-client-ip': randomIp(),
          },
          body: JSON.stringify({ email, redirectTo: '/reimposta' }),
        }),
      )
    const known = await ask(w.member.email)
    const unknown = await ask('nessuno@esempio.it')
    expect(known.status).toBe(200)
    expect(known.status).toBe(unknown.status)
    expect(await known.text()).toBe(await unknown.text())
    expect(errors.some((e) => e.includes('password reset email not queued'))).toBe(true)
    expect(errors.join('\n')).not.toContain('reset-password/')
  })

  test('changing the password keeps the method and the 30-day start of the session', async () => {
    const p = await person('cambio-metodo')
    const here = await signedInCookie(p.email)
    const started = new Date(Date.now() - 2 * 86_400_000)
    await admin.query(
      "update sessions set auth_method = 'password_totp', created_at = $2 where user_id = $1",
      [p.id, started],
    )
    const res = await post(
      '/change-password',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      { cookie: here },
    )
    expect(res.status).toBe(200)
    const { rows } = await admin.query<{ auth_method: string; created_at: Date }>(
      'select auth_method, created_at from sessions where user_id = $1',
      [p.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.auth_method).toBe('password_totp')
    expect(rows[0]?.created_at.getTime()).toBe(started.getTime())
  })
})

import { createHmac, hkdfSync, randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  activateAccount,
  createAuthEventSink,
  createPasswordResetLink,
  createOrganization,
  disableUserEverywhere,
  enableUserEverywhere,
  findOrganizationBySlug,
  listMyOrganizations,
  listOrganizations,
  lockAccountFromSecurityEmail,
  platformUserIdByEmail,
  reactivateOrganization,
  resolveOrgActor,
  resolveSessionUser,
  setOrganizationLimits,
  suspendOrganization,
  SYSTEM_PLATFORM_ACTOR,
  type Auth,
  type IdentityDeps,
  type JobPayloads,
  type JobQueue,
  type Mailer,
  type PlatformCaller,
  type PlatformDeps,
  type UnitOfWork,
} from '@app/application'
import type { PlatformActor } from '@app/domain'
import { createDb, type Db } from '../db/client.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createKeyRing } from '../crypto/key-ring.js'
import { createMemoryMailer } from '../mail/memory-mailer.js'
import { notConfiguredMailer } from '../mail/not-configured-mailer.js'
import { createPasswordHasher } from '../crypto/password-hasher.js'
import { passwordStrength } from '../crypto/password-strength.js'
import { createSignedTokens } from '../crypto/signed-tokens.js'
import { createTokenService } from '../crypto/tokens.js'
import { createPgRateLimiter } from '../db/rate-limiter.js'
import { createLogger } from '../logging/logger.js'
import { systemClock } from '../system/clock.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { fixedClock, seed, startTestDatabase, type TestDatabase } from '../testing/index.js'
import { createAuthAdapter } from './auth-adapter.js'
import { createBetterAuth, type BetterAuthInstance } from './better-auth.js'

const PANEL = 'https://app.feedway.test'
// low entropy on purpose: made-up values, not secrets for the leak scanner
const PASSWORD = 'cavallo-batteria-graffetta-lago'
const NEW_PASSWORD = 'tramonto-ombrello-giraffa-canale'

let tdb: TestDatabase
let admin: pg.Client
let db: Db
let instance: BetterAuthInstance
let auth: Auth
let uow: UnitOfWork
let deps: PlatformDeps & { queue: JobQueue; mailer: Mailer; signedTokens: typeof signedTokens }
let identityDeps: IdentityDeps
let platformAdmin: PlatformActor
const tokens = createTokenService()
const lockKey = randomBytes(32)
const signedTokens = createSignedTokens(lockKey)
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

beforeAll(async () => {
  tdb = await startTestDatabase()
  db = createDb(tdb.runtimeUrl, { max: 6, applicationName: 'platform-test' }).db
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  uow = createUnitOfWork({ db, ids: uuidV7Generator, logger })
  const secret = randomBytes(32).toString('hex')
  instance = createBetterAuth({
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
    logger,
    queue,
    events: createAuthEventSink({ uow, queue, tokens: signedTokens, clock: systemClock, logger }),
    resolveSessionUser: (session) =>
      resolveSessionUser({ uow, config: { require2fa: 'admins' } }, session),
  })
  auth = createAuthAdapter(instance, { db, clock: systemClock })
  const keyRing = createKeyRing({ platformKey: randomBytes(32), clock: systemClock })
  deps = {
    uow,
    clock: systemClock,
    ids: uuidV7Generator,
    tokens,
    keyRing,
    config: { panelUrl: PANEL },
    queue,
    mailer: createMemoryMailer(),
    signedTokens,
  }
  identityDeps = {
    uow,
    clock: systemClock,
    ids: uuidV7Generator,
    auth,
    tokens,
    keyRing,
    passwordStrength,
    rateLimiter: createPgRateLimiter({ db, clock: systemClock }),
    config: {
      bootstrapOwnerEmail: null,
      bootstrapOrganizationName: '',
      require2fa: 'admins',
      panelUrl: PANEL,
    },
  }
  const me = await person('piattaforma')
  await admin.query("update users set platform_role = 'admin' where id = $1", [me.id])
  platformAdmin = { userId: me.id, platformRole: 'admin' }
})
afterAll(async () => {
  await admin.end()
  await tdb.stop()
})

const uniqueEmail = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@esempio.it`
const tokenOf = (url: string) => decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '')
const randomIp = () =>
  `10.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250))}.1`

async function person(prefix = 'persona') {
  const id = randomUUID()
  const email = uniqueEmail(prefix)
  await auth.createUser({ id, email, name: 'Anna Rossi', password: PASSWORD })
  return { id, email }
}

function signIn(email: string, password = PASSWORD) {
  return instance.handler(
    new Request(`${PANEL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: PANEL, 'x-app-client-ip': randomIp() },
      body: JSON.stringify({ email, password }),
    }),
  )
}

function post(path: string, body: unknown) {
  return instance.handler(
    new Request(`${PANEL}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: PANEL, 'x-app-client-ip': randomIp() },
      body: JSON.stringify(body),
    }),
  )
}

async function sessionCount(userId: string) {
  const { rows } = await admin.query<{ n: number }>(
    'select count(*)::int as n from sessions where user_id = $1',
    [userId],
  )
  return rows[0]?.n ?? 0
}

async function platformAudit(action: string) {
  const { rows } = await admin.query<{
    action: string
    organization_id: string | null
    actor_id: string | null
    source: string
    entity_id: string | null
    data: Record<string, unknown>
  }>(
    `select action, organization_id, actor_id, source, entity_id, data from audit_log
      where action = $1 order by created_at desc, id desc`,
    [action],
  )
  return rows
}

async function organizationRow(id: string) {
  const { rows } = await admin.query<{
    status: string
    suspended_at: Date | null
    limits: Record<string, unknown>
    slug: string
  }>('select status, suspended_at, limits, slug from organizations where id = $1', [id])
  return rows[0]
}

const notAdmin: PlatformActor = { userId: randomUUID(), platformRole: null }

describe('organizations', () => {
  test('platform admin creates an organization with a new owner', async () => {
    const before = Date.now()
    const r = await createOrganization(deps, platformAdmin, {
      name: 'Agenzia Bianchi',
      ownerEmail: 'luca@bianchi.it',
    })
    expect(r.slug).toBe('agenzia-bianchi')
    expect(r.ownerActivationUrl).toMatch(/^https:\/\/app\.feedway\.test\/attiva\//)
    const keys = await admin.query('select 1 from organization_keys where organization_id = $1', [
      r.organizationId,
    ])
    expect(keys.rowCount).toBe(1)
    const { rows } = await admin.query<{ purpose: string; org_role: string; expires_at: Date }>(
      'select purpose, org_role, expires_at from invites where organization_id = $1',
      [r.organizationId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ purpose: 'organization_owner', org_role: 'owner' })
    const ttl = (rows[0]?.expires_at.getTime() ?? 0) - before
    expect(ttl).toBeGreaterThanOrEqual(3600_000 - 1000)
    expect(ttl).toBeLessThanOrEqual(3600_000 + 60_000)
    // a platform action: never in the agency's own log
    expect((await platformAudit('organization.created'))[0]).toMatchObject({
      organization_id: null,
      actor_id: platformAdmin.userId,
      source: 'panel',
      entity_id: r.organizationId,
    })
    expect(JSON.stringify((await platformAudit('organization.created'))[0]?.data)).not.toContain(
      '@',
    )

    // the link makes the new person the Owner
    const activated = await activateAccount(identityDeps, {
      token: tokenOf(r.ownerActivationUrl ?? ''),
      name: 'Luca Bianchi',
      nickname: null,
      password: NEW_PASSWORD,
      ip: null,
      userAgent: null,
      sessionUserId: null,
    })
    expect(activated.organizationSlug).toBe('agenzia-bianchi')
    const owner = await admin.query<{ role: string }>(
      `select m.role from organization_members m join users u on u.id = m.user_id
        where m.organization_id = $1 and u.email = 'luca@bianchi.it'`,
      [r.organizationId],
    )
    expect(owner.rows).toEqual([{ role: 'owner' }])
  })

  test('existing user becomes owner immediately', async () => {
    const existing = await person('esistente')
    // the plan's example name 'X' is one character: agency names have 2 to 80, like the first one
    const r = await createOrganization(deps, platformAdmin, {
      name: 'XY',
      ownerEmail: ` ${existing.email.toUpperCase()} `,
    })
    expect(r.ownerActivationUrl).toBeNull()
    expect(r.slug).toBe('xy')
    const orgs = await listMyOrganizations({ uow }, { userId: existing.id })
    expect(orgs).toEqual([
      { id: r.organizationId, slug: 'xy', name: 'XY', role: 'owner', status: 'active' },
    ])
    const invites = await admin.query('select 1 from invites where organization_id = $1', [
      r.organizationId,
    ])
    expect(invites.rowCount).toBe(0)
  })

  test('a disabled or anonymized account never becomes an owner', async () => {
    const disabled = await person('disattivato')
    await admin.query("update users set status = 'disabled', disabled_at = now() where id = $1", [
      disabled.id,
    ])
    await expect(
      createOrganization(deps, platformAdmin, {
        name: 'Agenzia Spenta',
        ownerEmail: disabled.email,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    const anonymized = await person('anonimo')
    await admin.query('update users set anonymized_at = now() where id = $1', [anonymized.id])
    await expect(
      createOrganization(deps, platformAdmin, {
        name: 'Agenzia Anonima',
        ownerEmail: anonymized.email,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    const left = await admin.query(
      "select 1 from organizations where name in ('Agenzia Spenta', 'Agenzia Anonima')",
    )
    expect(left.rowCount).toBe(0)
  })

  test('non platform admin cannot create organizations', async () => {
    await expect(
      createOrganization(
        deps,
        { userId: 'u', platformRole: null },
        { name: 'X', ownerEmail: 'a@b.it' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  test('a platform role that is gone in the database counts for nothing', async () => {
    const former = await person('ex-admin')
    // the actor says admin, the database no longer does
    await expect(
      createOrganization(
        deps,
        { userId: former.id, platformRole: 'admin' },
        { name: 'Agenzia Fantasma', ownerEmail: 'f@fantasma.it' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await admin.query(
      "update users set platform_role = 'admin', status = 'disabled', disabled_at = now() where id = $1",
      [former.id],
    )
    await expect(
      createOrganization(
        deps,
        { userId: former.id, platformRole: 'admin' },
        { name: 'Agenzia Fantasma', ownerEmail: 'f@fantasma.it' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  test('reserved words never become organization slugs', async () => {
    expect(
      (await createOrganization(deps, platformAdmin, { name: 'Profilo', ownerEmail: 'p@p.it' }))
        .slug,
    ).toBe('profilo-2')
    // a taken slug gets the next suffix
    const again = await createOrganization(deps, platformAdmin, {
      name: 'Agenzia Bianchi',
      ownerEmail: 'altro@bianchi.it',
    })
    expect(again.slug).toBe('agenzia-bianchi-2')
  })

  test('a new agency’s name is plain text: no links', async () => {
    await expect(
      createOrganization(deps, platformAdmin, {
        name: 'Agenzia http://truffa.example',
        ownerEmail: 'titolare@esempio.it',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'Il nome dell’agenzia non può contenere link o caratteri speciali',
      details: { field: 'name' },
    })
  })

  test('name and owner email are checked', async () => {
    await expect(
      createOrganization(deps, platformAdmin, { name: ' A ', ownerEmail: 'a@b.it' }),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { field: 'name' } })
    await expect(
      createOrganization(deps, platformAdmin, { name: 'Agenzia Valida', ownerEmail: 'non-email' }),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { field: 'ownerEmail' } })
  })

  test('an owner link for an agency that already has an owner leaves no account behind', async () => {
    const r = await createOrganization(deps, platformAdmin, {
      name: 'Agenzia Contesa',
      ownerEmail: 'nuovo@contesa.it',
    })
    const other = await person('primo-owner')
    await seed(tdb.runtimeUrl, (s) => s.member(r.organizationId, other.id, 'owner'))
    await expect(
      activateAccount(identityDeps, {
        token: tokenOf(r.ownerActivationUrl ?? ''),
        name: 'Nuovo Owner',
        nickname: null,
        password: NEW_PASSWORD,
        ip: null,
        userAgent: null,
        sessionUserId: null,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    const users = await admin.query("select 1 from users where email = 'nuovo@contesa.it'")
    expect(users.rowCount).toBe(0)
  })

  test('the system actor creates an organization and is recorded as the system', async () => {
    const r = await createOrganization(deps, SYSTEM_PLATFORM_ACTOR, {
      name: 'Agenzia di Sistema',
      ownerEmail: 's@sistema.it',
    })
    const entry = (await platformAudit('organization.created')).find(
      (e) => e.entity_id === r.organizationId,
    )
    expect(entry).toMatchObject({ organization_id: null, actor_id: null, source: 'system' })
    const { rows } = await admin.query<{ invited_by: string | null }>(
      'select invited_by from invites where organization_id = $1',
      [r.organizationId],
    )
    expect(rows).toEqual([{ invited_by: null }])
  })
})

describe('suspension and limits', () => {
  test('a suspended agency answers 403 to its members and comes back on reactivation', async () => {
    const owner = await person('sospesa')
    const r = await createOrganization(deps, platformAdmin, {
      name: 'Agenzia Sospesa',
      ownerEmail: owner.email,
    })
    await suspendOrganization(deps, platformAdmin, r.organizationId)
    expect(await organizationRow(r.organizationId)).toMatchObject({ status: 'suspended' })
    expect((await organizationRow(r.organizationId))?.suspended_at).not.toBeNull()
    await expect(
      resolveOrgActor({ uow }, { userId: owner.id, organizationSlug: r.slug }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_SUSPENDED' })
    expect((await listMyOrganizations({ uow }, { userId: owner.id }))[0]?.status).toBe('suspended')
    // repeating changes nothing and records nothing
    const entries = (await platformAudit('organization.suspended')).length
    await suspendOrganization(deps, platformAdmin, r.organizationId)
    expect((await platformAudit('organization.suspended')).length).toBe(entries)
    expect((await platformAudit('organization.suspended'))[0]).toMatchObject({
      organization_id: null,
      entity_id: r.organizationId,
    })

    await reactivateOrganization(deps, platformAdmin, r.organizationId)
    expect(await organizationRow(r.organizationId)).toMatchObject({
      status: 'active',
      suspended_at: null,
    })
    const actor = await resolveOrgActor({ uow }, { userId: owner.id, organizationSlug: r.slug })
    expect(actor.orgRole).toBe('owner')
    expect((await platformAudit('organization.reactivated'))[0]?.entity_id).toBe(r.organizationId)
  })

  test('suspension needs a platform admin and an agency that exists', async () => {
    const { orgId } = await seed(tdb.runtimeUrl, async (s) => ({ orgId: await s.organization() }))
    await expect(suspendOrganization(deps, notAdmin, orgId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(suspendOrganization(deps, platformAdmin, randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(suspendOrganization(deps, platformAdmin, 'non-un-id')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(await organizationRow(orgId)).toMatchObject({ status: 'active' })
  })

  test('limits are replaced as a whole and checked', async () => {
    const { orgId } = await seed(tdb.runtimeUrl, async (s) => ({ orgId: await s.organization() }))
    await setOrganizationLimits(deps, platformAdmin, orgId, { users: 5, workspaces: 2 })
    expect((await organizationRow(orgId))?.limits).toEqual({ users: 5, workspaces: 2 })
    expect((await platformAudit('organization.limits_changed'))[0]).toMatchObject({
      organization_id: null,
      entity_id: orgId,
      data: { limits: { users: 5, workspaces: 2 } },
    })
    // a key left out is unlimited
    await setOrganizationLimits(deps, platformAdmin, orgId, { posts_per_day: 10 })
    expect((await organizationRow(orgId))?.limits).toEqual({ posts_per_day: 10 })
    for (const bad of [{ users: -1 }, { users: 1.5 }, { seats: 3 }]) {
      await expect(
        setOrganizationLimits(deps, platformAdmin, orgId, bad as Record<string, number>),
      ).rejects.toMatchObject({ code: 'VALIDATION' })
    }
    await expect(setOrganizationLimits(deps, notAdmin, orgId, {})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect((await organizationRow(orgId))?.limits).toEqual({ posts_per_day: 10 })
  })

  test('the platform list shows status, usage and limits of every agency', async () => {
    const owner = await person('elenco')
    const r = await createOrganization(deps, platformAdmin, {
      name: 'Agenzia Elenco',
      ownerEmail: owner.email,
    })
    await seed(tdb.runtimeUrl, async (s) => {
      await s.workspace(r.organizationId)
      await s.workspace(r.organizationId, { archived: true })
    })
    await setOrganizationLimits(deps, platformAdmin, r.organizationId, { users: 3 })
    const list = await listOrganizations(deps, platformAdmin)
    expect(list.find((o) => o.id === r.organizationId)).toMatchObject({
      slug: 'agenzia-elenco',
      name: 'Agenzia Elenco',
      status: 'active',
      limits: { users: 3 },
      usage: { users: 1, workspaces: 1 },
    })
    expect(list.length).toBeGreaterThan(1)
    await expect(listOrganizations(deps, notAdmin)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await findOrganizationBySlug(deps, SYSTEM_PLATFORM_ACTOR, 'agenzia-elenco')).id).toBe(
      r.organizationId,
    )
    await expect(
      findOrganizationBySlug(deps, SYSTEM_PLATFORM_ACTOR, 'non-esiste'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('platform users', () => {
  async function inTwoAgencies() {
    const user = await person('entrambe')
    const { orgA, orgB } = await seed(tdb.runtimeUrl, async (s) => {
      const orgA = await s.organization()
      const orgB = await s.organization()
      await s.member(orgA, user.id, 'member')
      await s.member(orgB, user.id, 'admin')
      return { orgA, orgB }
    })
    return { user, orgA, orgB }
  }

  test('platform disable-user closes sessions in every organization and blocks sign-in', async () => {
    const { user, orgA, orgB } = await inTwoAgencies()
    expect((await signIn(user.email)).status).toBe(200)
    expect((await signIn(user.email)).status).toBe(200)
    expect(await sessionCount(user.id)).toBe(2)

    expect(await disableUserEverywhere(deps, platformAdmin, user.id)).toBe('disabled')
    expect(await sessionCount(user.id)).toBe(0)
    expect((await signIn(user.email)).status).toBe(401)
    for (const org of [orgA, orgB])
      await expect(
        resolveOrgActor({ uow }, { userId: user.id, organizationSlug: org }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await platformAudit('user.disabled'))[0]).toMatchObject({
      organization_id: null,
      actor_id: platformAdmin.userId,
      entity_id: user.id,
    })
    // memberships are untouched: each agency keeps its own decision
    const { rows } = await admin.query<{ status: string }>(
      'select status from organization_members where user_id = $1',
      [user.id],
    )
    expect(rows.map((r) => r.status)).toEqual(['active', 'active'])

    // repeating records nothing
    const entries = (await platformAudit('user.disabled')).length
    expect(await disableUserEverywhere(deps, platformAdmin, user.id)).toBe('already_disabled')
    expect((await platformAudit('user.disabled')).length).toBe(entries)

    // disabled by the platform, not locked by the person: the password stays
    expect(await enableUserEverywhere(deps, platformAdmin, user.id)).toEqual({
      status: 'enabled',
      recovery: null,
    })
    const enabled = (await platformAudit('user.enabled')).length
    expect(await enableUserEverywhere(deps, platformAdmin, user.id)).toEqual({
      status: 'already_active',
      recovery: null,
    })
    expect((await platformAudit('user.enabled')).length).toBe(enabled)
    expect((await signIn(user.email)).status).toBe(200)
    const actor = await resolveOrgActor({ uow }, { userId: user.id, organizationSlug: orgB })
    expect(actor.orgRole).toBe('admin')
    const { rows: users } = await admin.query<{
      status: string
      disabled_at: Date | null
      reactivated_at: Date | null
    }>('select status, disabled_at, reactivated_at from users where id = $1', [user.id])
    expect(users[0]).toMatchObject({ status: 'active', disabled_at: null })
    expect(users[0]?.reactivated_at).not.toBeNull()
    expect((await platformAudit('user.enabled'))[0]).toMatchObject({
      organization_id: null,
      entity_id: user.id,
    })
  })

  const recoveryJobs = (userId: string) =>
    queued
      .filter((q) => q.name === 'identity.account_recovery_email')
      .map((q) => q.data as JobPayloads['identity.account_recovery_email'])
      .filter((d) => d.userId === userId)
  const phone = { identityVerification: { method: 'phone_known_number' as const } }
  const errorCode = async (res: Response) => ((await res.json()) as { code?: string }).code ?? ''
  const sessionCookie = (res: Response) =>
    res.headers
      .getSetCookie()
      .find((c) => c.startsWith('__Host-session='))
      ?.split(';')[0] ?? ''
  async function secondFactors(userId: string) {
    await admin.query(
      `insert into passkeys (id, public_key, user_id, credential_id, counter, device_type, backed_up)
       values ($1, 'chiave', $2, $3, 0, 'singleDevice', false)`,
      [randomUUID(), userId, randomUUID()],
    )
    await admin.query(
      `insert into two_factors (id, secret, backup_codes, user_id) values ($1, 'segreto', 'codici', $2)`,
      [randomUUID(), userId],
    )
    await admin.query('update users set two_factor_enabled = true where id = $1', [userId])
  }
  async function secondFactorRows(userId: string) {
    const { rows } = await admin.query<{ passkeys: number; totp: number; enabled: boolean }>(
      `select (select count(*)::int from passkeys where user_id = $1) as passkeys,
              (select count(*)::int from two_factors where user_id = $1) as totp,
              (select two_factor_enabled from users where id = $1) as enabled`,
      [userId],
    )
    return rows[0]
  }
  async function lockNow(userId: string, clock: ReturnType<typeof fixedClock>) {
    await lockAccountFromSecurityEmail(
      { uow, tokens: signedTokens, clock, queue },
      {
        token: signedTokens.sign('security_lock', {
          userId,
          issuedAt: clock.now(),
          expiresAt: new Date(clock.now().getTime() + 86_400_000),
        }),
        ip: null,
      },
    )
  }

  test('enable-user after a security lock needs the identity checked, then emails a 30-minute link', async () => {
    const user = await person('bloccato')
    // two agencies: a link from the platform is not limited to people of one agency
    await seed(tdb.runtimeUrl, async (s) => {
      await s.member(await s.organization(), user.id, 'member')
      await s.member(await s.organization(), user.id, 'member')
    })
    // a passkey and an authenticator app the intruder may have added
    await secondFactors(user.id)
    const clock = fixedClock(new Date())
    const lockDeps = { uow, tokens: signedTokens, clock, queue }
    const sign = () =>
      signedTokens.sign('security_lock', {
        userId: user.id,
        issuedAt: clock.now(),
        expiresAt: new Date(clock.now().getTime() + 7 * 86_400_000),
      })
    const first = sign()
    clock.advance(1000)
    const second = sign()
    clock.advance(1000)
    await lockAccountFromSecurityEmail(lockDeps, { token: first, ip: null })
    expect((await signIn(user.email)).status).toBe(401)

    // without saying how the identity was checked nothing changes; free text is refused too
    clock.advance(1000)
    const at = { ...deps, clock }
    await expect(enableUserEverywhere(at, SYSTEM_PLATFORM_ACTOR, user.id)).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringMatching(/verificato l’identità/) as unknown,
    })
    await expect(
      enableUserEverywhere(at, SYSTEM_PLATFORM_ACTOR, user.id, {
        identityVerification: { method: 'mi ha scritto su chat' as 'in_person' },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    const { rows: still } = await admin.query<{ status: string }>(
      'select status from users where id = $1',
      [user.id],
    )
    expect(still[0]?.status).toBe('disabled')
    expect(recoveryJobs(user.id)).toEqual([])

    const enabled = await enableUserEverywhere(at, SYSTEM_PLATFORM_ACTOR, user.id, phone)
    // the link goes to the account's address, never to the operator
    expect(enabled).toEqual({ status: 'enabled', recovery: { channel: 'email' } })
    const [sent, ...others] = recoveryJobs(user.id)
    expect(others).toEqual([])
    const url = sent?.url ?? ''
    expect(url).toMatch(/^https:\/\/app\.feedway\.test\/api\/auth\/reset-password\/platform\./)
    expect(sent?.expiresAt).toBe(new Date(clock.now().getTime() + 30 * 60_000).toISOString())
    const { rows: link } = await admin.query<{ expires_at: Date }>(
      'select expires_at from verifications where identifier = $1',
      [`reset-password:${tokenOf(url)}`],
    )
    expect(link[0]?.expires_at.getTime()).toBe(clock.now().getTime() + 30 * 60_000)
    // the link is the only thing pending for the person: no code or other row beside it
    const { rows: pendingRows } = await admin.query<{ identifier: string }>(
      'select identifier from verifications where strpos(value, $1) > 0',
      [user.id],
    )
    expect(pendingRows).toEqual([{ identifier: `reset-password:${tokenOf(url)}` }])
    // the old password is gone, with the same answer as a wrong one
    const refused = await signIn(user.email)
    expect(refused.status).toBe(401)
    expect(await refused.text()).toBe(
      await (await signIn(user.email, 'sbagliata-del-tutto')).text(),
    )
    // passkeys, authenticator app and recovery codes are gone too
    expect(await secondFactorRows(user.id)).toEqual({ passkeys: 0, totp: 0, enabled: false })
    // how the identity was checked, then the reactivation, then where the link went
    const { rows: entries } = await admin.query<{ action: string; data: unknown }>(
      `select action, data from audit_log where entity_id = $1 and action in
        ('user.identity_verified', 'user.enabled', 'auth.recovery_link_sent')
        order by created_at, id`,
      [user.id],
    )
    expect(entries).toEqual([
      { action: 'user.identity_verified', data: { method: 'phone_known_number' } },
      {
        action: 'user.enabled',
        data: {
          scope: 'platform',
          sessionsClosed: 0,
          passwordCleared: true,
          resetLinkIssued: true,
          passkeysRemoved: 1,
          totpRemoved: 1,
        },
      },
      { action: 'auth.recovery_link_sent', data: { channel: 'email' } },
    ])

    // links issued before the reactivation cannot lock the account again
    for (const token of [first, second])
      await expect(
        lockAccountFromSecurityEmail(lockDeps, { token, ip: null }),
      ).rejects.toMatchObject({ code: 'LINK_INVALID' })

    // the link opens the reset page and sets a new password, once
    const opened = await instance.handler(
      new Request(url, { headers: { 'x-app-client-ip': randomIp() } }),
    )
    expect(opened.status).toBe(302)
    const page = new URL(opened.headers.get('location') ?? '')
    expect(page.pathname).toBe('/reimposta')
    const resetToken = page.searchParams.get('token') ?? ''
    // the link alone is enough (Matteo's choice of 27/10): no code
    const reset = await post('/reset-password', { token: resetToken, newPassword: NEW_PASSWORD })
    expect(reset.status).toBe(200)
    expect((await signIn(user.email, NEW_PASSWORD)).status).toBe(200)
    expect((await signIn(user.email)).status).toBe(401)
    const again = await post('/reset-password', { token: resetToken, newPassword: PASSWORD })
    expect(again.status).toBe(400)
    expect((await signIn(user.email)).status).toBe(401)

    // a link from a later email still works
    clock.advance(1000)
    await lockAccountFromSecurityEmail(lockDeps, { token: sign(), ip: null })
    expect((await signIn(user.email, NEW_PASSWORD)).status).toBe(401)
  })

  test('the recovery link stops working after 30 minutes, whatever the email says', async () => {
    const user = await person('scaduto')
    // the reactivation happened 31 minutes ago
    const clock = fixedClock(new Date(Date.now() - 31 * 60_000))
    await lockAccountFromSecurityEmail(
      { uow, tokens: signedTokens, clock, queue },
      {
        token: signedTokens.sign('security_lock', {
          userId: user.id,
          issuedAt: clock.now(),
          expiresAt: new Date(clock.now().getTime() + 86_400_000),
        }),
        ip: null,
      },
    )
    clock.advance(1000)
    await enableUserEverywhere({ ...deps, clock }, SYSTEM_PLATFORM_ACTOR, user.id, phone)
    const url = recoveryJobs(user.id)[0]?.url ?? ''
    const opened = await instance.handler(
      new Request(url, { headers: { 'x-app-client-ip': randomIp() } }),
    )
    expect(new URL(opened.headers.get('location') ?? '', PANEL).searchParams.get('error')).toBe(
      'INVALID_TOKEN',
    )
    const reset = await post('/reset-password', { token: tokenOf(url), newPassword: NEW_PASSWORD })
    expect(reset.status).toBe(400)
    expect((await signIn(user.email, NEW_PASSWORD)).status).toBe(401)
  })

  /** Locked, then enabled after a phone check: the recovery is pending. */
  async function pendingRecovery(prefix: string) {
    const user = await person(prefix)
    const clock = fixedClock(new Date())
    await lockNow(user.id, clock)
    clock.advance(1000)
    await enableUserEverywhere({ ...deps, clock }, SYSTEM_PLATFORM_ACTOR, user.id, phone)
    const url = recoveryJobs(user.id).at(-1)?.url ?? ''
    return { ...user, clock, token: tokenOf(url) }
  }
  const hasPassword = async (userId: string) =>
    (
      await admin.query(
        "select 1 from accounts where user_id = $1 and provider_id = 'credential'",
        [userId],
      )
    ).rowCount === 1

  test('a recovery token in the query string, or an empty token in the body, is refused', async () => {
    const user = await pendingRecovery('token-in-query')
    for (const body of [{ token: '', newPassword: NEW_PASSWORD }, { newPassword: NEW_PASSWORD }]) {
      const res = await instance.handler(
        new Request(`${PANEL}/api/auth/reset-password?token=${encodeURIComponent(user.token)}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: PANEL,
            'x-app-client-ip': randomIp(),
          },
          body: JSON.stringify(body),
        }),
      )
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('LINK_INVALID')
    }
    expect(await hasPassword(user.id)).toBe(false)
    expect((await signIn(user.email, NEW_PASSWORD)).status).toBe(401)
    // the right request still works: nothing was spent
    const reset = await post('/reset-password', {
      token: user.token,
      newPassword: NEW_PASSWORD,
    })
    expect(reset.status).toBe(200)
  })

  test('while a recovery is pending, no ordinary reset is issued or accepted', async () => {
    const user = await pendingRecovery('in-sospeso')
    // "Password dimenticata": the same answer as an unknown email, and nothing is sent
    const before = queued.length
    const asked = await post('/request-password-reset', {
      email: user.email,
      redirectTo: '/reimposta',
    })
    const unknown = await post('/request-password-reset', {
      email: uniqueEmail('nessuno'),
      redirectTo: '/reimposta',
    })
    expect(asked.status).toBe(unknown.status)
    expect(await asked.text()).toBe(await unknown.text())
    expect(
      queued
        .slice(before)
        .filter(
          (q) =>
            q.name === 'identity.password_reset_email' &&
            (q.data as { userId: string }).userId === user.id,
        ),
    ).toEqual([])
    // a reset token issued anyway (an agency's copied link, an older "Password dimenticata")
    for (const url of [await auth.passwordResetUrl(user.email)]) {
      const res = await post('/reset-password', {
        token: tokenOf(url ?? ''),
        newPassword: NEW_PASSWORD,
      })
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('LINK_INVALID')
    }
    const plain = `semplice-${randomUUID()}`
    await admin.query(
      `insert into verifications (id, identifier, value, expires_at) values ($1, $2, $3, now() + interval '1 hour')`,
      [randomUUID(), `reset-password:${plain}`, user.id],
    )
    const forgot = await post('/reset-password', { token: plain, newPassword: NEW_PASSWORD })
    expect(forgot.status).toBe(400)
    expect(await errorCode(forgot)).toBe('LINK_INVALID')
    expect(await hasPassword(user.id)).toBe(false)

    // the agency's panel says why it cannot make one
    const { orgId } = await seed(tdb.runtimeUrl, async (s) => {
      const orgId = await s.organization()
      await s.member(orgId, user.id, 'member')
      return { orgId }
    })
    const owner = await person('titolare-pannello')
    await admin.query(
      "insert into organization_members (organization_id, user_id, role, status) values ($1, $2, 'owner', 'active')",
      [orgId, owner.id],
    )
    const actor = await resolveOrgActor({ uow }, { userId: owner.id, organizationSlug: orgId })
    const now = new Date()
    const session = {
      id: randomUUID(),
      userId: owner.id,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 3600_000),
      ipAddress: null,
      userAgent: null,
      authMethod: 'password_totp' as const,
      reauthenticatedAt: now,
    }
    await expect(
      createPasswordResetLink(identityDeps, actor, session, user.id, { ip: null }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringMatching(/Non sono stato io/) as unknown,
    })

    // once the person has chosen the password with the recovery link, all is back to normal
    const reset = await post('/reset-password', {
      token: user.token,
      newPassword: NEW_PASSWORD,
    })
    expect(reset.status).toBe(200)
    const { rows } = await admin.query<{ security_locked_at: Date | null }>(
      'select security_locked_at from users where id = $1',
      [user.id],
    )
    expect(rows[0]?.security_locked_at).toBeNull()
    const again = queued.length
    await post('/request-password-reset', { email: user.email, redirectTo: '/reimposta' })
    expect(
      queued.slice(again).filter((q) => q.name === 'identity.password_reset_email').length,
    ).toBe(1)
  })

  test('a lost or spent recovery starts over: enable-user again revokes the old link', async () => {
    const user = await pendingRecovery('di-nuovo')
    // the email got lost: with the identity checked again, a new link replaces the old one
    user.clock.advance(1000)
    const again = await enableUserEverywhere(
      { ...deps, clock: user.clock },
      SYSTEM_PLATFORM_ACTOR,
      user.id,
      { identityVerification: { method: 'in_person' } },
    )
    expect(again).toEqual({ status: 'recovery_reissued', recovery: { channel: 'email' } })
    const token = tokenOf(recoveryJobs(user.id).at(-1)?.url ?? '')
    expect(token).not.toBe(user.token)
    const replaced = await post('/reset-password', { token: user.token, newPassword: NEW_PASSWORD })
    expect(await errorCode(replaced)).toBe('INVALID_TOKEN')
    // a refused password does not spend the link
    const weak = await post('/reset-password', { token, newPassword: 'corta' })
    expect(weak.status).not.toBe(200)
    const reset = await post('/reset-password', { token, newPassword: NEW_PASSWORD })
    expect(reset.status).toBe(200)
    expect((await signIn(user.email, NEW_PASSWORD)).status).toBe(200)
    // without the identity check nothing is reissued
    const second = await pendingRecovery('senza-verifica')
    await expect(
      enableUserEverywhere(deps, SYSTEM_PLATFORM_ACTOR, second.id),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    second.clock.advance(1000)
    await enableUserEverywhere(
      { ...deps, clock: second.clock },
      SYSTEM_PLATFORM_ACTOR,
      second.id,
      phone,
    )
    const old = await post('/reset-password', {
      token: second.token,
      newPassword: NEW_PASSWORD,
    })
    expect(await errorCode(old)).toBe('INVALID_TOKEN')
    const entries = (await platformAudit('auth.recovery_link_sent')).filter(
      (e) => e.entity_id === second.id,
    )
    expect(entries.map((e) => e.data)).toEqual([
      { channel: 'email', reissued: true },
      { channel: 'email' },
    ])
  })

  test('if closing the recovery fails after the new password, nothing stays stuck', async () => {
    const user = await pendingRecovery('chiusura-fallita')
    // the database refuses to clear the mark for this person: the after hook fails
    const fn = `fail_clear_${user.id.replaceAll('-', '_')}`
    await admin.query(`create function ${fn}() returns trigger language plpgsql as $$
      begin
        if new.id = '${user.id}' and new.security_locked_at is null
           and old.security_locked_at is not null then
          raise exception 'chiusura del recupero non riuscita';
        end if;
        return new;
      end $$`)
    await admin.query(
      `create trigger ${fn} before update on users for each row execute function ${fn}()`,
    )
    let reset: Response
    try {
      reset = await post('/reset-password', {
        token: user.token,
        newPassword: NEW_PASSWORD,
      })
    } finally {
      await admin.query(`drop trigger ${fn} on users`)
      await admin.query(`drop function ${fn}()`)
    }
    // the password is changed: the answer says so, and the mark is still there
    expect(reset.status).toBe(200)
    const mark = async () =>
      (
        await admin.query<{ security_locked_at: Date | null }>(
          'select security_locked_at from users where id = $1',
          [user.id],
        )
      ).rows[0]?.security_locked_at ?? null
    expect(await mark()).not.toBeNull()
    expect((await signIn(user.email, NEW_PASSWORD)).status).toBe(200)

    // ordinary resets work: the person has chosen a password, the recovery is over
    const before = queued.length
    await post('/request-password-reset', { email: user.email, redirectTo: '/reimposta' })
    expect(
      queued.slice(before).filter((q) => q.name === 'identity.password_reset_email').length,
    ).toBe(1)
    // and enable-user does not take the new password away: it only clears the stale mark
    user.clock.advance(1000)
    const again = await enableUserEverywhere(
      { ...deps, clock: user.clock },
      SYSTEM_PLATFORM_ACTOR,
      user.id,
      phone,
    )
    expect(again).toEqual({ status: 'already_active', recovery: null })
    expect(await mark()).toBeNull()
    expect(await hasPassword(user.id)).toBe(true)
    expect((await signIn(user.email, NEW_PASSWORD)).status).toBe(200)
  })

  test('a new lock while the recovery is pending locks again and tells the administrators', async () => {
    const user = await pendingRecovery('di-nuovo-bloccato')
    user.clock.advance(1000)
    const before = queued.length
    await lockNow(user.id, user.clock)
    const notices = queued.slice(before).filter((q) => q.name === 'identity.account_locked_notice')
    expect(notices.map((q) => q.data)).toEqual([
      { lockedUserId: user.id, lockedAt: user.clock.now().toISOString() },
    ])
    const { rows } = await admin.query<{ status: string }>(
      'select status from users where id = $1',
      [user.id],
    )
    expect(rows[0]?.status).toBe('disabled')
    // the pending recovery link went with the lock
    const old = await post('/reset-password', {
      token: user.token,
      newPassword: NEW_PASSWORD,
    })
    expect(await errorCode(old)).toBe('INVALID_TOKEN')
  })

  test('after the recovery an Owner sets up the second factor again at once', async () => {
    const user = await person('titolare-recuperato')
    await seed(tdb.runtimeUrl, async (s) => {
      await s.member(await s.organization(), user.id, 'owner')
    })
    await secondFactors(user.id)
    const clock = fixedClock(new Date())
    await lockNow(user.id, clock)
    clock.advance(1000)
    await enableUserEverywhere({ ...deps, clock }, SYSTEM_PLATFORM_ACTOR, user.id, phone)
    const token = tokenOf(recoveryJobs(user.id)[0]?.url ?? '')
    const reset = await post('/reset-password', { token, newPassword: NEW_PASSWORD })
    expect(reset.status).toBe(200)
    // the password alone opens a session that may do nothing but set up the second factor
    const signedIn = await signIn(user.email, NEW_PASSWORD)
    expect(signedIn.status).toBe(200)
    const cookie = sessionCookie(signedIn)
    const session = await auth.getSession(new Headers({ cookie }))
    if (!session) throw new Error('no session after the recovery')
    const resolved = await resolveSessionUser(
      { uow, config: { require2fa: 'admins' } },
      session.session,
    )
    expect(resolved?.state).toBe('second_factor_required')
    const setup = await instance.handler(
      new Request(`${PANEL}/api/auth/two-factor/enable`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: PANEL,
          'x-app-client-ip': randomIp(),
          cookie,
        },
        body: JSON.stringify({ password: NEW_PASSWORD }),
      }),
    )
    expect(setup.status).toBe(200)
    expect(((await setup.json()) as { totpURI?: string }).totpURI).toMatch(/^otpauth:\/\//)
  })

  test('without email the operator gets the link, and the log says so', async () => {
    const user = await person('senza-posta')
    const clock = fixedClock(new Date())
    await lockAccountFromSecurityEmail(
      { uow, tokens: signedTokens, clock, queue },
      {
        token: signedTokens.sign('security_lock', {
          userId: user.id,
          issuedAt: clock.now(),
          expiresAt: new Date(clock.now().getTime() + 86_400_000),
        }),
        ip: null,
      },
    )
    clock.advance(1000)
    const enabled = await enableUserEverywhere(
      { ...deps, clock, mailer: notConfiguredMailer },
      SYSTEM_PLATFORM_ACTOR,
      user.id,
      { identityVerification: { method: 'video_call' } },
    )
    expect(enabled.recovery).toEqual({
      channel: 'operator',
      url: expect.stringMatching(/\/api\/auth\/reset-password\/platform\./) as unknown,
    })
    expect(recoveryJobs(user.id)).toEqual([])
    const entry = (await platformAudit('auth.recovery_link_sent')).find(
      (e) => e.entity_id === user.id,
    )
    expect(entry?.data).toEqual({ channel: 'operator' })
    expect(
      (await platformAudit('user.identity_verified')).find((e) => e.entity_id === user.id)?.data,
    ).toEqual({
      method: 'video_call',
    })
  })

  test('a lock on an account the platform had already disabled still voids the password', async () => {
    const user = await person('doppio')
    await disableUserEverywhere(deps, platformAdmin, user.id)
    const clock = fixedClock(new Date())
    await lockAccountFromSecurityEmail(
      { uow, tokens: signedTokens, clock, queue },
      {
        token: signedTokens.sign('security_lock', {
          userId: user.id,
          issuedAt: clock.now(),
          expiresAt: new Date(clock.now().getTime() + 86_400_000),
        }),
        ip: null,
      },
    )
    clock.advance(1000)
    const enabled = await enableUserEverywhere({ ...deps, clock }, platformAdmin, user.id, {
      identityVerification: { method: 'in_person' },
    })
    expect(enabled.recovery?.channel).toBe('email')
    expect((await signIn(user.email)).status).toBe(401)
  })

  test('only a platform admin acts on accounts, never on itself or another admin', async () => {
    const user = await person('protetto')
    await expect(disableUserEverywhere(deps, notAdmin, user.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(
      disableUserEverywhere(deps, platformAdmin, platformAdmin.userId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const other = await person('altro-admin')
    await admin.query("update users set platform_role = 'admin' where id = $1", [other.id])
    await expect(disableUserEverywhere(deps, platformAdmin, other.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(disableUserEverywhere(deps, platformAdmin, randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(disableUserEverywhere(deps, platformAdmin, 'non-un-id')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect((await signIn(user.email)).status).toBe(200)
  })

  test('an anonymized account is never enabled again', async () => {
    const user = await person('anonimizzato')
    await admin.query(
      "update users set status = 'disabled', disabled_at = now(), anonymized_at = now() where id = $1",
      [user.id],
    )
    await expect(enableUserEverywhere(deps, platformAdmin, user.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(await disableUserEverywhere(deps, platformAdmin, user.id)).toBe('anonymized')
  })

  test('the platform finds an account by email, in any case', async () => {
    const user = await person('cercato')
    expect(
      await platformUserIdByEmail(deps, SYSTEM_PLATFORM_ACTOR, ` ${user.email.toUpperCase()}`),
    ).toBe(user.id)
    await expect(
      platformUserIdByEmail(deps, SYSTEM_PLATFORM_ACTOR, 'nessuno@esempio.it'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(platformUserIdByEmail(deps, notAdmin, user.email)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  test('an undated lock link from before issue times is refused after a reactivation', async () => {
    const user = await person('senza-data')
    const body = Buffer.from(
      JSON.stringify({ u: user.id, e: Date.now() + 7 * 86_400_000 }),
    ).toString('base64url')
    const key = Buffer.from(
      hkdfSync('sha256', lockKey, Buffer.alloc(0), 'feedway:signed:security_lock', 32),
    )
    const undated = `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`
    expect(signedTokens.verify('security_lock', undated, new Date())?.issuedAt).toBeNull()
    await admin.query("update users set status = 'disabled', disabled_at = now() where id = $1", [
      user.id,
    ])
    await enableUserEverywhere(deps, SYSTEM_PLATFORM_ACTOR, user.id)
    await expect(
      lockAccountFromSecurityEmail(
        { uow, tokens: signedTokens, clock: systemClock, queue },
        { token: undated, ip: null },
      ),
    ).rejects.toMatchObject({ code: 'LINK_INVALID' })
    expect((await signIn(user.email)).status).toBe(200)
  })

  test('from the panel an admin never enables itself or another platform admin', async () => {
    const other = await person('altro-admin-2')
    await admin.query(
      "update users set platform_role = 'admin', status = 'disabled', disabled_at = now() where id = $1",
      [other.id],
    )
    await expect(enableUserEverywhere(deps, platformAdmin, other.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(
      enableUserEverywhere(deps, platformAdmin, platformAdmin.userId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const { rows } = await admin.query<{ status: string }>(
      'select status from users where id = $1',
      [other.id],
    )
    expect(rows[0]?.status).toBe('disabled')
  })
})

describe('callers', () => {
  test('a look-alike of the system actor is an ordinary caller', async () => {
    const lookAlike = { kind: 'system' } as unknown as PlatformCaller
    await expect(
      createOrganization(deps, lookAlike, { name: 'Agenzia Finta', ownerEmail: 'f@finta.it' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const user = await person('sosia')
    await expect(disableUserEverywhere(deps, lookAlike, user.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect((await signIn(user.email)).status).toBe(200)
  })

  test('a demoted or disabled platform admin can do nothing', async () => {
    const { orgId } = await seed(tdb.runtimeUrl, async (s) => ({ orgId: await s.organization() }))
    const target = await person('bersaglio')
    for (const change of ['platform_role = null', "status = 'disabled', disabled_at = now()"]) {
      const former = await person('ex')
      await admin.query(`update users set platform_role = 'admin' where id = $1`, [former.id])
      await admin.query(`update users set ${change} where id = $1`, [former.id])
      const stale: PlatformActor = { userId: former.id, platformRole: 'admin' }
      for (const attempt of [
        () => suspendOrganization(deps, stale, orgId),
        () => reactivateOrganization(deps, stale, orgId),
        () => setOrganizationLimits(deps, stale, orgId, { users: 1 }),
        () => listOrganizations(deps, stale),
        () => disableUserEverywhere(deps, stale, target.id),
        () => enableUserEverywhere(deps, stale, target.id),
        () => platformUserIdByEmail(deps, stale, target.email),
      ])
        await expect(attempt()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    expect(await organizationRow(orgId)).toMatchObject({ status: 'active', limits: {} })
    expect((await signIn(target.email)).status).toBe(200)
  })
})

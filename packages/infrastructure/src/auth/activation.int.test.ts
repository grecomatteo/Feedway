import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import {
  activateAccount,
  completeActivation,
  createAuthEventSink,
  createBootstrapLink,
  describeLink,
  FIRST_ORGANIZATION_SETTING,
  type ActivationInput,
  type Auth,
  type IdentityDeps,
  type InvitePurpose,
  type JobQueue,
  type UnitOfWork,
} from '@app/application'
import type { OrgRole, WorkspaceRole } from '@app/domain'
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
import { fixedClock, seed, startTestDatabase, type TestDatabase } from '../testing/index.js'
import { createAuthAdapter } from './auth-adapter.js'
import { createBetterAuth, type BetterAuthInstance } from './better-auth.js'

const PANEL = 'https://app.feedway.test'
// low entropy on purpose: made-up values, not secrets for the leak scanner
const STRONG = 'cavallo-batteria-graffetta-lago'
const OTHER_STRONG = 'tramonto-ombrello-giraffa-canale'
const OWNER_EMAIL = 'titolare@esempio.it'

let tdb: TestDatabase
let db: Db
let admin: pg.Client
let instance: BetterAuthInstance
let auth: Auth
let uow: UnitOfWork
let deps: IdentityDeps
const tokens = createTokenService()
const logger = createLogger({ service: 'web', level: 'error' })

const noQueue: JobQueue = {
  send: () => Promise.resolve(null),
  work: () => Promise.reject(new Error('not used')),
  ping: () => Promise.resolve(),
  stop: () => Promise.resolve(),
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  db = createDb(tdb.runtimeUrl, { max: 5, applicationName: 'activation-test' }).db
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
    events: createAuthEventSink({
      uow,
      queue: noQueue,
      tokens: createSignedTokens(randomBytes(32)),
      clock: systemClock,
      logger,
    }),
  })
  auth = createAuthAdapter(instance, { db, clock: systemClock })
  deps = {
    uow,
    clock: systemClock,
    ids: uuidV7Generator,
    auth,
    tokens,
    keyRing: createKeyRing({ platformKey: randomBytes(32), clock: systemClock }),
    passwordStrength,
    config: {
      bootstrapOwnerEmail: OWNER_EMAIL,
      bootstrapOrganizationName: '',
      panelUrl: PANEL,
    },
  }
})
afterAll(async () => {
  await admin.end()
  await tdb.stop()
})

const tokenOf = (url: string) => decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '')
const uniqueEmail = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@esempio.it`

const form = (token: string, extra: Partial<ActivationInput> = {}): ActivationInput => ({
  token,
  name: 'Persona Nuova',
  nickname: null,
  password: STRONG,
  ip: '93.41.12.200',
  userAgent: 'Mozilla/5.0',
  sessionUserId: null,
  ...extra,
})

async function newAgency() {
  return seed(tdb.runtimeUrl, async (s) => {
    const organizationId = await s.organization()
    const workspaceId = await s.workspace(organizationId)
    return { organizationId, workspaceId }
  })
}

async function inviteFixture(
  email: string,
  opts: {
    purpose?: InvitePurpose
    organizationId?: string
    orgRole?: OrgRole
    memberships?: { workspaceId: string; role: WorkspaceRole }[]
    existingUserId?: string
  } = {},
) {
  const agency = opts.organizationId ? null : await newAgency()
  const organizationId = opts.organizationId ?? agency?.organizationId ?? null
  const { token, hash } = tokens.generate()
  await uow.runAsSystem('test invite', (tx) =>
    tx.invites.create({
      id: randomUUID(),
      organizationId,
      purpose: opts.purpose ?? 'invite',
      email,
      existingUserId: opts.existingUserId ?? null,
      tokenHash: hash,
      invitedBy: null,
      orgRole: opts.orgRole ?? 'member',
      memberships:
        opts.memberships ?? (agency ? [{ workspaceId: agency.workspaceId, role: 'editor' }] : []),
      expiresAt: new Date(Date.now() + 3600_000),
    }),
  )
  return { token, organizationId }
}

async function userByEmail(email: string) {
  const { rows } = await admin.query<{
    id: string
    name: string
    nickname: string | null
    platform_role: string | null
  }>('select id, name, nickname, platform_role from users where email = $1', [email])
  return rows
}
async function membershipsOf(email: string) {
  const { rows } = await admin.query<{ organization_id: string; role: string }>(
    `select m.organization_id, m.role from organization_members m join users u on u.id = m.user_id
      where u.email = $1`,
    [email],
  )
  return rows
}
async function addPasskeyDirectly(userId: string) {
  await admin.query(
    `insert into passkeys (id, public_key, user_id, credential_id, counter, device_type, backed_up)
     values ($1, 'chiave', $2, $3, 0, 'singleDevice', false)`,
    [randomUUID(), userId, randomUUID()],
  )
}
function signIn(email: string, password: string) {
  return instance.handler(
    new Request(`${PANEL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: PANEL,
        'x-app-client-ip': `10.9.${String(Math.floor(Math.random() * 250))}.1`,
      },
      body: JSON.stringify({ email, password }),
    }),
  )
}

/** Same deps, with one step failing: as if the process died there. */
function failing(step: 'createUser' | 'memberships' | 'openSession'): IdentityDeps {
  const brokenUow: UnitOfWork = {
    run: (scope, fn) => uow.run(scope, fn),
    runAsSystem: (reason, fn) =>
      step === 'memberships' && reason === 'activation: memberships'
        ? Promise.reject(new Error('processo interrotto'))
        : uow.runAsSystem(reason, fn),
  }
  const brokenAuth: Auth = {
    ...auth,
    createUser: (input) =>
      step === 'createUser'
        ? Promise.reject(new Error('processo interrotto'))
        : auth.createUser(input),
    openSession: (userId, meta) =>
      step === 'openSession'
        ? Promise.reject(new Error('processo interrotto'))
        : auth.openSession(userId, meta),
  }
  return { ...deps, uow: brokenUow, auth: brokenAuth }
}

describe('bootstrap', () => {
  beforeEach(async () => {
    await admin.query('update users set platform_role = null')
  })

  test('bootstrap creates platform admin who owns the first organization', async () => {
    const { url } = await createBootstrapLink(deps)
    expect(url).toMatch(/^https:\/\/app\.feedway\.test\/attiva\//)
    expect(await describeLink(deps, { token: tokenOf(url) })).toEqual({
      purpose: 'bootstrap',
      email: OWNER_EMAIL,
      organizationName: null,
      existingUser: false,
    })
    const r = await activateAccount(deps, form(tokenOf(url), { name: 'Matteo', nickname: 'Teo' }))
    const [u] = await userByEmail(OWNER_EMAIL)
    expect(u).toMatchObject({ name: 'Matteo', nickname: 'Teo', platform_role: 'admin' })
    expect(r.organizationSlug).toBe('la-mia-agenzia')
    expect(r.next).toBe('done')
    expect(await membershipsOf(OWNER_EMAIL)).toEqual([
      { organization_id: expect.any(String) as string, role: 'owner' },
    ])
    const organizationId = (await membershipsOf(OWNER_EMAIL))[0]?.organization_id
    const keys = await admin.query('select 1 from organization_keys where organization_id = $1', [
      organizationId,
    ])
    expect(keys.rowCount).toBe(1)
    const setting = await admin.query<{ value: unknown }>(
      'select value from settings where key = $1',
      [FIRST_ORGANIZATION_SETTING],
    )
    expect(setting.rows[0]?.value).toBe(organizationId)
    const audit = await admin.query<{ action: string; organization_id: string; ip: string }>(
      'select action, organization_id, host(ip) as ip from audit_log where actor_id = $1',
      [u?.id],
    )
    expect(audit.rows).toContainEqual({
      action: 'user.activated',
      organization_id: organizationId,
      ip: '93.41.12.200',
    })
    // the session cookie of the activation is a real one
    const cookie = r.setCookie.find((c) => c.startsWith('__Host-session='))?.split(';')[0]
    const session = await auth.getSession(new Headers({ cookie: cookie ?? '' }))
    expect(session?.userId).toBe(u?.id)
    expect(session?.session.authMethod).toBe('activation')
    await expect(createBootstrapLink(deps)).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  test('bootstrap needs the owner email', async () => {
    await expect(
      createBootstrapLink({ ...deps, config: { ...deps.config, bootstrapOwnerEmail: null } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  test('a new bootstrap link replaces the previous one', async () => {
    const first = await createBootstrapLink(deps)
    await createBootstrapLink(deps)
    await expect(describeLink(deps, { token: tokenOf(first.url) })).rejects.toMatchObject({
      code: 'LINK_INVALID',
    })
  })

  test('bootstrap link expires after one hour', async () => {
    const clock = fixedClock(new Date())
    const { url } = await createBootstrapLink({ ...deps, clock })
    clock.advance(61 * 60_000)
    await expect(activateAccount({ ...deps, clock }, form(tokenOf(url)))).rejects.toMatchObject({
      code: 'LINK_INVALID',
    })
  })

  test('interrupted bootstrap does not create a second organization', async () => {
    const config = {
      ...deps.config,
      bootstrapOwnerEmail: uniqueEmail('avvio'),
      bootstrapOrganizationName: 'Agenzia Avvio',
    }
    const { url } = await createBootstrapLink({ ...deps, config })
    // passkey path: the link stays open after the memberships, the session step fails
    await expect(
      activateAccount(
        { ...failing('openSession'), config },
        form(tokenOf(url), { password: null }),
      ),
    ).rejects.toThrow('processo interrotto')
    const again = await activateAccount({ ...deps, config }, form(tokenOf(url), { password: null }))
    expect(again).toMatchObject({ organizationSlug: 'agenzia-avvio', next: 'register_passkey' })
    expect(await membershipsOf(config.bootstrapOwnerEmail)).toHaveLength(1)
    const orgs = await admin.query("select 1 from organizations where name = 'Agenzia Avvio'")
    expect(orgs.rowCount).toBe(1)
  })
})

describe('invites', () => {
  test('an invite makes the person a member of the agency and its workspaces', async () => {
    const email = uniqueEmail('invito')
    const agency = await newAgency()
    const { token } = await inviteFixture(email, {
      organizationId: agency.organizationId,
      orgRole: 'member',
      memberships: [{ workspaceId: agency.workspaceId, role: 'editor' }],
    })
    const r = await activateAccount(deps, form(token))
    expect(r.next).toBe('done')
    const [u] = await userByEmail(email)
    const ws = await admin.query<{ role: string }>(
      'select role from workspace_members where user_id = $1 and workspace_id = $2',
      [u?.id, agency.workspaceId],
    )
    expect(ws.rows).toEqual([{ role: 'editor' }])
    expect((await signIn(email, STRONG)).status).toBe(200)
  })

  test('activation interrupted after the user was created completes with the same link', async () => {
    const email = uniqueEmail('nuovo')
    const { token } = await inviteFixture(email)
    await expect(activateAccount(failing('memberships'), form(token))).rejects.toThrow()
    await activateAccount(deps, form(token, { password: OTHER_STRONG }))
    expect(await userByEmail(email)).toHaveLength(1)
    expect(await membershipsOf(email)).toHaveLength(1)
    // the retry set the password it was given
    expect((await signIn(email, OTHER_STRONG)).status).toBe(200)
  })

  test('two concurrent activations create one user and one membership', async () => {
    const email = uniqueEmail('doppio')
    const { token } = await inviteFixture(email)
    const results = await Promise.allSettled([
      activateAccount(deps, form(token)),
      activateAccount(deps, form(token)),
    ])
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true)
    expect(await userByEmail(email)).toHaveLength(1)
    expect(await membershipsOf(email)).toHaveLength(1)
  })

  test('used link cannot be used again', async () => {
    const { token } = await inviteFixture(uniqueEmail('usato'))
    await activateAccount(deps, form(token))
    await expect(activateAccount(deps, form(token))).rejects.toMatchObject({ code: 'LINK_INVALID' })
    await expect(describeLink(deps, { token })).rejects.toMatchObject({ code: 'LINK_INVALID' })
  })

  test('passkey path keeps the link open until a passkey exists', async () => {
    const email = uniqueEmail('pk')
    const { token } = await inviteFixture(email)
    const r = await activateAccount(deps, form(token, { password: null }))
    expect(r.next).toBe('register_passkey')
    expect(r.setCookie.some((c) => c.startsWith('__Host-session='))).toBe(true)
    const [u] = await userByEmail(email)
    const userId = u?.id ?? ''
    await expect(completeActivation(deps, { token, userId })).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await expect(completeActivation(deps, { token, userId: randomUUID() })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    })
    await addPasskeyDirectly(userId)
    await completeActivation(deps, { token, userId })
    await expect(activateAccount(deps, form(token))).rejects.toMatchObject({ code: 'LINK_INVALID' })
  })

  test('existing user must be signed in as themselves to accept', async () => {
    const email = uniqueEmail('esistente')
    const userId = uuidV7Generator.newId()
    await auth.createUser({ id: userId, email, name: 'Già Registrata', password: STRONG })
    const { token } = await inviteFixture(email, { existingUserId: userId })
    expect(await describeLink(deps, { token })).toMatchObject({ existingUser: true })
    await expect(activateAccount(deps, form(token))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    })
    await expect(
      activateAccount(deps, form(token, { sessionUserId: randomUUID() })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    const r = await activateAccount(deps, form(token, { sessionUserId: userId }))
    expect(r).toMatchObject({ setCookie: [], next: 'done' })
    expect(await userByEmail(email)).toHaveLength(1)
    expect(await membershipsOf(email)).toHaveLength(1)
  })

  test('an invite never changes the credentials of an existing user', async () => {
    const email = uniqueEmail('credenziali')
    const userId = uuidV7Generator.newId()
    await auth.createUser({ id: userId, email, name: 'Nome Vero', password: STRONG })
    const { token } = await inviteFixture(email, { existingUserId: userId })
    await expect(
      activateAccount(deps, form(token, { password: OTHER_STRONG })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    await activateAccount(
      deps,
      form(token, {
        name: 'Altro nome',
        nickname: 'Altro',
        password: OTHER_STRONG,
        sessionUserId: userId,
      }),
    )
    expect((await signIn(email, STRONG)).status).toBe(200)
    expect((await signIn(email, OTHER_STRONG)).status).not.toBe(200)
    expect((await userByEmail(email))[0]).toMatchObject({ name: 'Nome Vero', nickname: null })
  })

  test('someone who registered after the invite was sent is treated as an existing user', async () => {
    const email = uniqueEmail('tardi')
    const { token } = await inviteFixture(email)
    // reserves the id, then stops before creating the account
    await expect(activateAccount(failing('createUser'), form(token))).rejects.toThrow()
    await auth.createUser({ id: uuidV7Generator.newId(), email, name: 'Altra', password: STRONG })
    await expect(activateAccount(deps, form(token))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    })
  })

  test('resume refuses a reserved user who already has a passkey', async () => {
    const email = uniqueEmail('ripresa')
    const { token } = await inviteFixture(email)
    await expect(activateAccount(failing('memberships'), form(token))).rejects.toThrow()
    const [u] = await userByEmail(email)
    await addPasskeyDirectly(u?.id ?? '')
    await expect(
      activateAccount(deps, form(token, { password: OTHER_STRONG })),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect((await signIn(email, OTHER_STRONG)).status).not.toBe(200)
  })

  test('resume refuses a reserved user who already belongs to another agency', async () => {
    const email = uniqueEmail('altrove')
    const { token } = await inviteFixture(email)
    await expect(activateAccount(failing('memberships'), form(token))).rejects.toThrow()
    const [u] = await userByEmail(email)
    const other = await newAgency()
    await seed(tdb.runtimeUrl, (s) => s.member(other.organizationId, u?.id ?? '', 'member'))
    await expect(
      activateAccount(deps, form(token, { password: OTHER_STRONG })),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  test('weak password is refused before any user is created', async () => {
    const email = uniqueEmail('debole')
    const { token } = await inviteFixture(email)
    await expect(
      activateAccount(deps, form(token, { password: 'passwordpassword' })),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { field: 'password' } })
    await expect(activateAccount(deps, form(token, { name: '  ' }))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { field: 'name' },
    })
    expect(await userByEmail(email)).toHaveLength(0)
  })

  test('the activation session endpoint is not reachable over HTTP', async () => {
    const res = await instance.handler(
      new Request(`${PANEL}/api/auth/internal/open-session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: PANEL },
        body: JSON.stringify({ userId: randomUUID(), ipAddress: null, userAgent: null }),
      }),
    )
    expect(res.status).toBe(404)
  })
})

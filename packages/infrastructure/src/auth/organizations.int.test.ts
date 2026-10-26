import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  createOrganization,
  getOrganizationSettings,
  listMyOrganizations,
  resolveOrgActor,
  resolveSessionUser,
  suspendOrganization,
  updateOrganizationSettings,
  SYSTEM_PLATFORM_ACTOR,
  type AuthSessionInfo,
  type OrganizationsDeps,
  type PlatformDeps,
  type UnitOfWork,
} from '@app/application'
import type { OrgActor, TwoFactorPolicy } from '@app/domain'
import { createDb } from '../db/client.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createKeyRing } from '../crypto/key-ring.js'
import { createTokenService } from '../crypto/tokens.js'
import { createLogger } from '../logging/logger.js'
import { systemClock } from '../system/clock.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { seed, startTestDatabase, type TestDatabase } from '../testing/index.js'

const PANEL = 'https://app.feedway.test'
const REQ = { ip: '93.41.12.200' }

let tdb: TestDatabase
let admin: pg.Client
let uow: UnitOfWork
let platformDeps: PlatformDeps
const logger = createLogger({ service: 'web', level: 'error' })

const depsWithPlatformPolicy = (require2fa: TwoFactorPolicy): OrganizationsDeps => ({
  uow,
  clock: systemClock,
  config: { require2fa },
})
let deps: OrganizationsDeps

beforeAll(async () => {
  tdb = await startTestDatabase()
  const db = createDb(tdb.runtimeUrl, { max: 4, applicationName: 'organizations-test' }).db
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  uow = createUnitOfWork({ db, ids: uuidV7Generator, logger })
  deps = depsWithPlatformPolicy('admins')
  platformDeps = {
    uow,
    clock: systemClock,
    ids: uuidV7Generator,
    tokens: createTokenService(),
    keyRing: createKeyRing({ platformKey: randomBytes(32), clock: systemClock }),
    config: { panelUrl: PANEL },
  }
})
afterAll(async () => {
  await admin.end()
  await tdb.stop()
})

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
    authMethod: 'password',
    reauthenticatedAt,
  }
}
const fresh = (actor: OrgActor) => sessionOf(actor.userId, new Date())
const stale = (actor: OrgActor) => sessionOf(actor.userId, null)

/** One agency with an Owner, an Admin and a Member (seed slugs are the agency ids). */
async function agency() {
  return seed(tdb.runtimeUrl, async (s) => {
    const org = await s.organization()
    const owner = await s.user()
    const adminUser = await s.user()
    const member = await s.user()
    await s.member(org, owner, 'owner')
    await s.member(org, adminUser, 'admin')
    await s.member(org, member, 'member')
    return { org, owner, admin: adminUser, member }
  })
}
const actorOf = (userId: string, organizationId: string) =>
  resolveOrgActor({ uow }, { userId, organizationSlug: organizationId })

async function settingsOf(organizationId: string) {
  const { rows } = await admin.query<{ name: string; slug: string; settings: unknown }>(
    'select name, slug, settings from organizations where id = $1',
    [organizationId],
  )
  return rows[0]
}
async function auditOf(organizationId: string) {
  const { rows } = await admin.query<{
    action: string
    actor_id: string
    data: Record<string, unknown>
    ip: string | null
  }>(
    `select action, actor_id, data, host(ip) as ip from audit_log
      where organization_id = $1 order by created_at desc, id desc`,
    [organizationId],
  )
  return rows
}

describe('agency switcher', () => {
  test('switcher lists own organizations', async () => {
    const userInAandB = await seed(tdb.runtimeUrl, (s) => s.user())
    for (const name of ['Agenzia B', 'Agenzia A'])
      await createOrganization(platformDeps, SYSTEM_PLATFORM_ACTOR, {
        name,
        ownerEmail: `${userInAandB}@example.test`,
      })
    expect(
      (await listMyOrganizations({ uow }, { userId: userInAandB })).map((o) => o.slug).sort(),
    ).toEqual(['agenzia-a', 'agenzia-b'])
  })

  test('a disabled membership is not listed, a suspended agency is listed as suspended', async () => {
    const { user, active, disabled, suspended } = await seed(tdb.runtimeUrl, async (s) => {
      const user = await s.user()
      const active = await s.organization()
      const disabled = await s.organization()
      const suspended = await s.organization()
      await s.organization() // someone else's agency
      await s.member(active, user, 'member')
      await s.member(disabled, user, 'admin', 'disabled')
      await s.member(suspended, user, 'member')
      return { user, active, disabled, suspended }
    })
    await suspendOrganization(platformDeps, SYSTEM_PLATFORM_ACTOR, suspended)
    const list = await listMyOrganizations({ uow }, { userId: user })
    expect(list.map((o) => [o.id, o.status, o.role]).sort()).toEqual(
      [
        [active, 'active', 'member'],
        [suspended, 'suspended', 'member'],
      ].sort(),
    )
    expect(list.map((o) => o.id)).not.toContain(disabled)
  })

  test('a disabled account lists nothing', async () => {
    const { user } = await seed(tdb.runtimeUrl, async (s) => {
      const user = await s.user()
      await s.member(await s.organization(), user, 'member')
      return { user }
    })
    await admin.query("update users set status = 'disabled', disabled_at = now() where id = $1", [
      user,
    ])
    expect(await listMyOrganizations({ uow }, { userId: user })).toEqual([])
  })
})

describe('organization settings', () => {
  test('owner and admin read the settings, a member cannot', async () => {
    const a = await agency()
    const expected = {
      id: a.org,
      slug: a.org,
      require2fa: null,
      platformRequire2fa: 'admins',
    }
    expect(await getOrganizationSettings(deps, await actorOf(a.owner, a.org))).toMatchObject(
      expected,
    )
    expect(await getOrganizationSettings(deps, await actorOf(a.admin, a.org))).toMatchObject(
      expected,
    )
    await expect(
      getOrganizationSettings(deps, await actorOf(a.member, a.org)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  test('owner raises the 2FA rule and renames the agency, with a recent reauth', async () => {
    const a = await agency()
    const owner = await actorOf(a.owner, a.org)
    await updateOrganizationSettings(
      deps,
      owner,
      fresh(owner),
      { name: '  Nuovo Nome  ', require2fa: 'all' },
      REQ,
    )
    const row = await settingsOf(a.org)
    expect(row).toMatchObject({ name: 'Nuovo Nome', slug: a.org, settings: { require2fa: 'all' } })
    const [entry] = await auditOf(a.org)
    expect(entry).toMatchObject({
      action: 'organization.settings_changed',
      actor_id: a.owner,
      ip: REQ.ip,
      data: { fields: ['name', 'require2fa'], require2fa: { from: null, to: 'all' } },
    })
    // the name itself never goes to the log
    expect(JSON.stringify(entry?.data)).not.toContain('Nuovo Nome')
    expect(await getOrganizationSettings(deps, owner)).toMatchObject({
      name: 'Nuovo Nome',
      require2fa: 'all',
    })

    // nothing changed: nothing recorded
    const entries = (await auditOf(a.org)).length
    await updateOrganizationSettings(
      deps,
      owner,
      fresh(owner),
      { name: 'Nuovo Nome', require2fa: 'all' },
      REQ,
    )
    expect((await auditOf(a.org)).length).toBe(entries)
  })

  test('raising the rule closes no session: a member without a second factor owes one next', async () => {
    const a = await agency()
    const owner = await actorOf(a.owner, a.org)
    const memberSession = sessionOf(a.member, null)
    const before = await resolveSessionUser(
      { uow, config: { require2fa: 'admins' } },
      memberSession,
    )
    expect(before?.state).toBe('active')
    await updateOrganizationSettings(deps, owner, fresh(owner), { require2fa: 'all' }, REQ)
    const after = await resolveSessionUser({ uow, config: { require2fa: 'admins' } }, memberSession)
    expect(after?.state).toBe('second_factor_required')
  })

  test('organization cannot lower 2FA below platform policy', async () => {
    const a = await agency()
    const owner = await actorOf(a.owner, a.org)
    await expect(
      updateOrganizationSettings(
        depsWithPlatformPolicy('all'),
        owner,
        fresh(owner),
        { require2fa: 'admins' },
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { field: 'require2fa' } })
    // with the platform at "admins" the owner may go back down to it
    await updateOrganizationSettings(deps, owner, fresh(owner), { require2fa: 'all' }, REQ)
    await updateOrganizationSettings(deps, owner, fresh(owner), { require2fa: 'admins' }, REQ)
    expect((await settingsOf(a.org))?.settings).toEqual({ require2fa: 'admins' })
  })

  test('admin cannot change organization settings', async () => {
    const a = await agency()
    const adminActor = await actorOf(a.admin, a.org)
    await expect(
      updateOrganizationSettings(deps, adminActor, fresh(adminActor), { require2fa: 'all' }, REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const member = await actorOf(a.member, a.org)
    await expect(
      updateOrganizationSettings(deps, member, fresh(member), { name: 'Presa' }, REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await settingsOf(a.org))?.settings).toEqual({})
  })

  test('settings need a recent reauth on the actor’s own session', async () => {
    const a = await agency()
    const owner = await actorOf(a.owner, a.org)
    await expect(
      updateOrganizationSettings(deps, owner, stale(owner), { require2fa: 'all' }, REQ),
    ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' })
    await expect(
      updateOrganizationSettings(
        deps,
        owner,
        sessionOf(a.admin, new Date()),
        { require2fa: 'all' },
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect((await settingsOf(a.org))?.settings).toEqual({})
  })

  test('an agency name is plain text: no links', async () => {
    const a = await agency()
    const owner = await actorOf(a.owner, a.org)
    for (const name of ['https://truffa.example', 'Agenzia www.truffa.example', 'Agenzia\u2066x'])
      await expect(
        updateOrganizationSettings(deps, owner, fresh(owner), { name }, REQ),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
        message: 'Il nome dell’agenzia non può contenere link o caratteri speciali',
        details: { field: 'name' },
      })
  })

  test('values from the routes are checked again', async () => {
    const a = await agency()
    const owner = await actorOf(a.owner, a.org)
    await expect(
      updateOrganizationSettings(deps, owner, fresh(owner), { name: 'x' }, REQ),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { field: 'name' } })
    await expect(
      updateOrganizationSettings(
        deps,
        owner,
        fresh(owner),
        { require2fa: 'none' as TwoFactorPolicy },
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { field: 'require2fa' } })
  })

  test('an owner changes only the own agency', async () => {
    const a = await agency()
    const b = await agency()
    const owner = await actorOf(a.owner, a.org)
    // an actor that claims agency B: the membership is read again inside the transaction
    const forged: OrgActor = { ...owner, organizationId: b.org }
    await expect(
      updateOrganizationSettings(deps, forged, fresh(owner), { name: 'Presa di B' }, REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await settingsOf(b.org))?.name).not.toBe('Presa di B')
  })
})

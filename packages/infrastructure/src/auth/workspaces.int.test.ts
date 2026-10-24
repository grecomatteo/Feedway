import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  addWorkspaceMember,
  archiveWorkspace,
  changeOrgRole,
  changeWorkspaceMemberRole,
  createAuthEventSink,
  createWorkspace,
  disableMember,
  listWorkspaceMembers,
  listWorkspaces,
  removeWorkspaceMember,
  renameWorkspace,
  resolveOrgActor,
  resolveSessionUser,
  type Auth,
  type AuthSessionInfo,
  type JobQueue,
  type UnitOfWork,
  type WorkspacesDeps,
} from '@app/application'
import type { OrgActor, WorkspaceRole } from '@app/domain'
import { createDb, type Db } from '../db/client.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createPasswordHasher } from '../crypto/password-hasher.js'
import { createSignedTokens } from '../crypto/signed-tokens.js'
import { createPgRateLimiter } from '../db/rate-limiter.js'
import { createLogger } from '../logging/logger.js'
import { systemClock } from '../system/clock.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { seed, startTestDatabase, withScope, type TestDatabase } from '../testing/index.js'
import { createAuthAdapter } from './auth-adapter.js'
import { createBetterAuth, type BetterAuthInstance } from './better-auth.js'

const PANEL = 'https://app.feedway.test'
// low entropy on purpose: made-up values, not secrets for the leak scanner
const PASSWORD = 'tramonto-ombrello-giraffa-canale'
const REQ = { ip: '93.41.12.200' }
const APP_NAME = 'workspaces-test'

let tdb: TestDatabase
let admin: pg.Client
let db: Db
let instance: BetterAuthInstance
let auth: Auth
let uow: UnitOfWork
let deps: WorkspacesDeps
const logger = createLogger({ service: 'web', level: 'error' })

const queue: JobQueue = {
  send: () => Promise.resolve(null),
  work: () => Promise.reject(new Error('not used')),
  ping: () => Promise.resolve(),
  stop: () => Promise.resolve(),
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  db = createDb(tdb.runtimeUrl, { max: 6, applicationName: APP_NAME }).db
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
  auth = createAuthAdapter(instance, { db, clock: systemClock })
  deps = { uow, clock: systemClock, ids: uuidV7Generator, auth }
})
afterAll(async () => {
  await admin.end()
  await tdb.stop()
})

const uniqueEmail = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@esempio.it`
const randomIp = () =>
  `10.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250))}.1`

async function person(prefix: string) {
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
      w1: await s.workspace(orgA, { name: 'Alfa' }),
      w2: await s.workspace(orgA, { name: 'Beta' }),
      wB: await s.workspace(orgB),
    }
  })
  const owner = await person('titolare')
  const adminA = await person('admin')
  const manager = await person('manager')
  const editor = await person('editor')
  const loose = await person('senzaspazi')
  const onlyB = await person('soloinb')
  await seed(tdb.runtimeUrl, async (s) => {
    await s.member(orgA, owner.id, 'owner')
    await s.member(orgA, adminA.id, 'admin')
    await s.member(orgA, manager.id, 'member')
    await s.workspaceMember(orgA, w1, manager.id, 'manager')
    await s.member(orgA, editor.id, 'member')
    await s.workspaceMember(orgA, w1, editor.id, 'editor')
    await s.member(orgA, loose.id, 'member')
    await s.member(orgB, onlyB.id, 'owner')
  })
  return { orgA, w1, w2, orgB, wB, owner, adminA, manager, editor, loose, onlyB }
}

/** Seed slugs are the agency ids. */
const actorOf = (userId: string, organizationId: string): Promise<OrgActor> =>
  resolveOrgActor({ uow }, { userId, organizationSlug: organizationId })

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

async function signIn(email: string) {
  const res = await instance.handler(
    new Request(`${PANEL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: PANEL,
        'x-app-client-ip': randomIp(),
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  )
  expect(res.status).toBe(200)
}
async function activeSessionsOf(userId: string) {
  const { rows } = await admin.query<{ id: string }>('select id from sessions where user_id = $1', [
    userId,
  ])
  return rows
}
async function auditOf(organizationId: string) {
  const { rows } = await admin.query<{
    action: string
    actor_id: string
    entity: string
    entity_id: string | null
    workspace_id: string | null
    data: Record<string, unknown> | null
    ip: string | null
  }>(
    `select action, actor_id, entity, entity_id, workspace_id, data, host(ip) as ip from audit_log
      where organization_id = $1 order by created_at desc, id desc`,
    [organizationId],
  )
  return rows
}
async function workspaceRoleOf(workspaceId: string, userId: string) {
  const { rows } = await admin.query<{ role: string }>(
    'select role from workspace_members where workspace_id = $1 and user_id = $2',
    [workspaceId, userId],
  )
  return rows[0]?.role
}
/** Limits change only in the system scope (a trigger guards them). */
async function setLimits(organizationId: string, limits: Record<string, unknown>) {
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query('update organizations set limits = $2 where id = $1', [organizationId, limits]),
  )
}
async function waitForWaiters(n: number) {
  const deadline = Date.now() + 10_000
  for (;;) {
    const { rows } = await admin.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
        where application_name = $1 and wait_event_type = 'Lock'`,
      [APP_NAME],
    )
    if ((rows[0]?.n ?? 0) >= n) return
    if (Date.now() > deadline) throw new Error('the creations never waited on the lock')
    await new Promise((r) => setTimeout(r, 20))
  }
}
const member = (workspaceId: string, userId: string, role: WorkspaceRole) => ({
  workspaceId,
  userId,
  role,
})

describe('workspaces', () => {
  test('slug is unique per organization', async () => {
    const w = await world()
    const ownerA = await actorOf(w.owner.id, w.orgA)
    const ownerB = await actorOf(w.onlyB.id, w.orgB)
    const first = await createWorkspace(deps, ownerA, { name: ' Caffè Roma ' }, REQ)
    expect(first).toEqual({
      id: expect.any(String) as string,
      name: 'Caffè Roma',
      slug: 'caffe-roma',
      archivedAt: null,
      myRole: 'owner',
    })
    expect((await createWorkspace(deps, ownerA, { name: 'Caffè  Roma' }, REQ)).slug).toBe(
      'caffe-roma-2',
    )
    expect((await createWorkspace(deps, ownerB, { name: 'Caffè Roma' }, REQ)).slug).toBe(
      'caffe-roma',
    )
    const [entry] = await auditOf(w.orgB)
    expect(entry).toMatchObject({
      action: 'workspace.created',
      actor_id: w.onlyB.id,
      entity: 'workspace',
      ip: REQ.ip,
    })
    // a client's name can be a person's: never in the log
    expect(JSON.stringify(entry)).not.toContain('Caff')
  })

  test('member cannot create workspaces; an admin can', async () => {
    const w = await world()
    const manager = await actorOf(w.manager.id, w.orgA)
    await expect(createWorkspace(deps, manager, { name: 'XY' }, REQ)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const adminA = await actorOf(w.adminA.id, w.orgA)
    await expect(createWorkspace(deps, adminA, { name: 'XY' }, REQ)).resolves.toMatchObject({
      myRole: 'admin',
    })
  })

  test('the name goes from 2 to 80 characters', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    for (const name of ['X', ' X ', 'a'.repeat(81), 'Due\u0000righe'])
      await expect(createWorkspace(deps, owner, { name }, REQ)).rejects.toMatchObject({
        code: 'VALIDATION',
      })
    await expect(renameWorkspace(deps, owner, w.w1, { name: 'X' }, REQ)).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  })

  test('workspace limit counts only active workspaces', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await setLimits(w.orgA, { workspaces: 2 })
    await expect(createWorkspace(deps, owner, { name: 'Terzo' }, REQ)).rejects.toMatchObject({
      code: 'LIMIT_REACHED',
    })
    await archiveWorkspace(deps, owner, w.w2, REQ)
    await expect(createWorkspace(deps, owner, { name: 'Terzo' }, REQ)).resolves.toBeDefined()
    // an unreadable limit closes
    await setLimits(w.orgA, { workspaces: 'tanti' })
    await expect(createWorkspace(deps, owner, { name: 'Quarto' }, REQ)).rejects.toMatchObject({
      code: 'LIMIT_REACHED',
    })
  })

  test('two creations at once cannot both take the last slot', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await setLimits(w.orgA, { workspaces: 3 })
    const holder = new pg.Client({ connectionString: tdb.adminUrl })
    await holder.connect()
    await holder.query('begin')
    await holder.query('select pg_advisory_xact_lock(hashtext($1))', [`workspaces:${w.orgA}`])
    const pending = Promise.allSettled([
      createWorkspace(deps, owner, { name: 'Stesso nome' }, REQ),
      createWorkspace(deps, owner, { name: 'Stesso nome' }, REQ),
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

  test('two creations with the same name at once get different slugs', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    const created = await Promise.all([
      createWorkspace(deps, owner, { name: 'Gemelli' }, REQ),
      createWorkspace(deps, owner, { name: 'Gemelli' }, REQ),
    ])
    expect(created.map((c) => c.slug).sort()).toEqual(['gemelli', 'gemelli-2'])
  })

  test('member lists only own workspaces with role', async () => {
    const w = await world()
    const editor = await actorOf(w.editor.id, w.orgA)
    expect(await listWorkspaces(deps, editor)).toEqual([
      { id: w.w1, name: 'Alfa', slug: w.w1, archivedAt: null, myRole: 'editor' },
    ])
    const loose = await actorOf(w.loose.id, w.orgA)
    expect(await listWorkspaces(deps, loose)).toEqual([])
    const owner = await actorOf(w.owner.id, w.orgA)
    await archiveWorkspace(deps, owner, w.w2, REQ)
    const adminA = await actorOf(w.adminA.id, w.orgA)
    const all = await listWorkspaces(deps, adminA)
    expect(all.map((x) => [x.id, x.myRole])).toEqual([
      [w.w1, 'admin'],
      [w.w2, 'admin'],
    ])
    expect(all[1]?.archivedAt).toEqual(expect.any(String))
    expect(new Date(all[1]?.archivedAt ?? '').getTime()).not.toBeNaN()
  })

  test('rename and archive: owner and admin only, guessed ids not found', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    const adminA = await actorOf(w.adminA.id, w.orgA)
    const manager = await actorOf(w.manager.id, w.orgA)
    await expect(
      renameWorkspace(deps, manager, w.w1, { name: 'Nuovo' }, REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // the permission comes before the name, as in createWorkspace
    await expect(renameWorkspace(deps, manager, w.w1, { name: 'X' }, REQ)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(archiveWorkspace(deps, manager, w.w1, REQ)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    for (const id of [w.wB, 'non-un-uuid', randomUUID()]) {
      await expect(renameWorkspace(deps, owner, id, { name: 'Nuovo' }, REQ)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
      await expect(archiveWorkspace(deps, owner, id, REQ)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    }

    const renamed = await renameWorkspace(deps, adminA, w.w1, { name: 'Alfa Due' }, REQ)
    // links depend on the slug: it never follows the name
    expect(renamed).toMatchObject({ id: w.w1, name: 'Alfa Due', slug: w.w1, myRole: 'admin' })
    expect((await auditOf(w.orgA))[0]).toMatchObject({
      action: 'workspace.renamed',
      entity_id: w.w1,
      workspace_id: w.w1,
    })
    const before = (await auditOf(w.orgA)).length
    await renameWorkspace(deps, adminA, w.w1, { name: 'Alfa Due' }, REQ)
    expect((await auditOf(w.orgA)).length).toBe(before)

    await archiveWorkspace(deps, owner, w.w1, REQ)
    expect((await auditOf(w.orgA))[0]).toMatchObject({
      action: 'workspace.archived',
      entity_id: w.w1,
    })
    // a repeat changes nothing and writes nothing
    await archiveWorkspace(deps, owner, w.w1, REQ)
    expect((await auditOf(w.orgA)).length).toBe(before + 1)
    // archived: readable, not changeable
    await expect(renameWorkspace(deps, owner, w.w1, { name: 'Ancora' }, REQ)).rejects.toMatchObject(
      { code: 'CONFLICT' },
    )
    const editor = await actorOf(w.editor.id, w.orgA)
    expect((await listWorkspaces(deps, editor))[0]).toMatchObject({ id: w.w1, name: 'Alfa Due' })
  })

  test('a suspended agency changes nothing', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
      c.query("update organizations set status = 'suspended', suspended_at = now() where id = $1", [
        w.orgA,
      ]),
    )
    await expect(createWorkspace(deps, owner, { name: 'Nuovo' }, REQ)).rejects.toMatchObject({
      code: 'ORGANIZATION_SUSPENDED',
    })
    await expect(renameWorkspace(deps, owner, w.w1, { name: 'Nuovo' }, REQ)).rejects.toMatchObject({
      code: 'ORGANIZATION_SUSPENDED',
    })
    await expect(archiveWorkspace(deps, owner, w.w1, REQ)).rejects.toMatchObject({
      code: 'ORGANIZATION_SUSPENDED',
    })
    await expect(
      addWorkspaceMember(deps, owner, fresh(owner), member(w.w1, w.loose.id, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_SUSPENDED' })
  })

  test('an admin demoted since the actor was built creates nothing', async () => {
    const w = await world()
    const adminA = await actorOf(w.adminA.id, w.orgA)
    const owner = await actorOf(w.owner.id, w.orgA)
    await changeOrgRole(
      { uow, clock: systemClock, auth },
      owner,
      fresh(owner),
      w.adminA.id,
      'member',
      REQ,
    )
    await expect(createWorkspace(deps, adminA, { name: 'Nuovo' }, REQ)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(archiveWorkspace(deps, adminA, w.w1, REQ)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})

describe('workspace members', () => {
  test('cannot add a user who is not in the organization', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    for (const userId of [w.onlyB.id, 'non-un-uuid', randomUUID()])
      await expect(
        addWorkspaceMember(deps, owner, fresh(owner), member(w.w1, userId, 'viewer'), REQ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    // disabled in this agency: reactivate first
    await disableMember({ uow, clock: systemClock, auth }, owner, fresh(owner), w.loose.id, REQ)
    await expect(
      addWorkspaceMember(deps, owner, fresh(owner), member(w.w1, w.loose.id, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  test('owner adds a member, who then sees the workspace and is signed out', async () => {
    const w = await world()
    await signIn(w.loose.email)
    const owner = await actorOf(w.owner.id, w.orgA)
    await addWorkspaceMember(deps, owner, fresh(owner), member(w.w2, w.loose.id, 'publisher'), REQ)
    expect(await workspaceRoleOf(w.w2, w.loose.id)).toBe('publisher')
    // a privilege change rotates the session (spec §10.3, §15.2)
    expect(await activeSessionsOf(w.loose.id)).toHaveLength(0)
    expect((await auditOf(w.orgA))[0]).toMatchObject({
      action: 'member.added',
      actor_id: w.owner.id,
      entity: 'user',
      entity_id: w.loose.id,
      workspace_id: w.w2,
      data: { role: 'publisher' },
      ip: REQ.ip,
    })
    const loose = await actorOf(w.loose.id, w.orgA)
    expect(await listWorkspaces(deps, loose)).toEqual([
      expect.objectContaining({ id: w.w2, myRole: 'publisher' }),
    ])
    expect(await listWorkspaceMembers(deps, owner, w.w2)).toEqual([
      {
        userId: w.loose.id,
        displayName: 'Anna Rossi',
        avatarUrl: null,
        role: 'publisher',
        status: 'active',
      },
    ])

    // the same add again changes nothing and signs nobody out; another role is a role change
    await signIn(w.loose.email)
    const before = (await auditOf(w.orgA)).length
    await addWorkspaceMember(deps, owner, fresh(owner), member(w.w2, w.loose.id, 'publisher'), REQ)
    expect((await auditOf(w.orgA)).length).toBe(before)
    expect(await activeSessionsOf(w.loose.id)).toHaveLength(1)
    await expect(
      addWorkspaceMember(deps, owner, fresh(owner), member(w.w2, w.loose.id, 'manager'), REQ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await workspaceRoleOf(w.w2, w.loose.id)).toBe('publisher')
  })

  test('guessed workspace id returns NOT_FOUND', async () => {
    const w = await world()
    const manager = await actorOf(w.manager.id, w.orgA)
    const owner = await actorOf(w.owner.id, w.orgA)
    await expect(listWorkspaceMembers(deps, manager, w.w2)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(listWorkspaceMembers(deps, owner, w.wB)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(listWorkspaceMembers(deps, owner, 'non-un-uuid')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    for (const ws of [w.w2, w.wB, 'non-un-uuid']) {
      await expect(
        addWorkspaceMember(deps, manager, fresh(manager), member(ws, w.loose.id, 'viewer'), REQ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(
        changeWorkspaceMemberRole(
          deps,
          manager,
          fresh(manager),
          member(ws, w.editor.id, 'viewer'),
          REQ,
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(
        removeWorkspaceMember(
          deps,
          manager,
          fresh(manager),
          { workspaceId: ws, userId: w.editor.id },
          REQ,
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    // a workspace they see but cannot manage: an editor does not list or change members
    const editor = await actorOf(w.editor.id, w.orgA)
    await expect(listWorkspaceMembers(deps, editor, w.w1)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(
      addWorkspaceMember(deps, editor, fresh(editor), member(w.w1, w.loose.id, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  test('manager cannot promote to manager nor touch other managers', async () => {
    const w = await world()
    const otherManager = await person('altromanager')
    await seed(tdb.runtimeUrl, async (s) => {
      await s.member(w.orgA, otherManager.id, 'member')
      await s.workspaceMember(w.orgA, w.w1, otherManager.id, 'manager')
    })
    const manager = await actorOf(w.manager.id, w.orgA)
    await expect(
      addWorkspaceMember(deps, manager, fresh(manager), member(w.w1, w.loose.id, 'manager'), REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      changeWorkspaceMemberRole(
        deps,
        manager,
        fresh(manager),
        member(w.w1, w.editor.id, 'manager'),
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      changeWorkspaceMemberRole(
        deps,
        manager,
        fresh(manager),
        member(w.w1, otherManager.id, 'viewer'),
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      removeWorkspaceMember(
        deps,
        manager,
        fresh(manager),
        { workspaceId: w.w1, userId: otherManager.id },
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // never on themselves
    await expect(
      removeWorkspaceMember(
        deps,
        manager,
        fresh(manager),
        { workspaceId: w.w1, userId: w.manager.id },
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // nor on Admins and the Owner
    await expect(
      addWorkspaceMember(deps, manager, fresh(manager), member(w.w1, w.adminA.id, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // lower roles are theirs to give
    await addWorkspaceMember(deps, manager, fresh(manager), member(w.w1, w.loose.id, 'viewer'), REQ)
    await changeWorkspaceMemberRole(
      deps,
      manager,
      fresh(manager),
      member(w.w1, w.loose.id, 'publisher'),
      REQ,
    )
    expect(await workspaceRoleOf(w.w1, w.loose.id)).toBe('publisher')
    expect(await listWorkspaceMembers(deps, manager, w.w1)).toHaveLength(4)
  })

  test('a manager demoted since the actor was built changes nothing', async () => {
    const w = await world()
    const manager = await actorOf(w.manager.id, w.orgA)
    const owner = await actorOf(w.owner.id, w.orgA)
    await changeWorkspaceMemberRole(
      deps,
      owner,
      fresh(owner),
      member(w.w1, w.manager.id, 'viewer'),
      REQ,
    )
    await expect(
      addWorkspaceMember(deps, manager, fresh(manager), member(w.w1, w.loose.id, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await workspaceRoleOf(w.w1, w.loose.id)).toBeUndefined()
  })

  test('a manager demoted while waiting for the workspace changes nothing', async () => {
    const w = await world()
    const manager = await actorOf(w.manager.id, w.orgA)
    // another change holds the workspace and demotes the manager before it commits
    const holder = new pg.Client({ connectionString: tdb.adminUrl })
    await holder.connect()
    await holder.query('begin')
    await holder.query('select id from workspaces where id = $1 for update', [w.w1])
    await holder.query(
      "update workspace_members set role = 'viewer' where workspace_id = $1 and user_id = $2",
      [w.w1, w.manager.id],
    )
    const pending = addWorkspaceMember(
      deps,
      manager,
      fresh(manager),
      member(w.w1, w.loose.id, 'viewer'),
      REQ,
    ).then(
      () => 'added',
      (e: unknown) => e,
    )
    await waitForWaiters(1)
    await holder.query('commit')
    await holder.end()
    expect(await pending).toMatchObject({ code: 'FORBIDDEN' })
    expect(await workspaceRoleOf(w.w1, w.loose.id)).toBeUndefined()
  })

  test('archived workspace rejects changes, but access can still be taken away', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await archiveWorkspace(deps, owner, w.w1, REQ)
    await expect(
      addWorkspaceMember(deps, owner, fresh(owner), member(w.w1, w.loose.id, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      changeWorkspaceMemberRole(
        deps,
        owner,
        fresh(owner),
        member(w.w1, w.editor.id, 'viewer'),
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    // archived stays readable: removing someone is how their access ends
    await removeWorkspaceMember(
      deps,
      owner,
      fresh(owner),
      { workspaceId: w.w1, userId: w.editor.id },
      REQ,
    )
    expect(await workspaceRoleOf(w.w1, w.editor.id)).toBeUndefined()
  })

  test('role change requires reauth and revokes sessions', async () => {
    const w = await world()
    await signIn(w.editor.email)
    const owner = await actorOf(w.owner.id, w.orgA)
    await expect(
      changeWorkspaceMemberRole(
        deps,
        owner,
        stale(owner),
        member(w.w1, w.editor.id, 'viewer'),
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' })
    expect(await activeSessionsOf(w.editor.id)).toHaveLength(1)
    expect(await workspaceRoleOf(w.w1, w.editor.id)).toBe('editor')

    // the same role: nothing recorded, nobody signed out
    const before = (await auditOf(w.orgA)).length
    await changeWorkspaceMemberRole(
      deps,
      owner,
      fresh(owner),
      member(w.w1, w.editor.id, 'editor'),
      REQ,
    )
    expect((await auditOf(w.orgA)).length).toBe(before)
    expect(await activeSessionsOf(w.editor.id)).toHaveLength(1)

    await changeWorkspaceMemberRole(
      deps,
      owner,
      fresh(owner),
      member(w.w1, w.editor.id, 'viewer'),
      REQ,
    )
    expect(await workspaceRoleOf(w.w1, w.editor.id)).toBe('viewer')
    expect(await activeSessionsOf(w.editor.id)).toHaveLength(0)
    expect((await auditOf(w.orgA))[0]).toMatchObject({
      action: 'member.role_changed',
      entity_id: w.editor.id,
      workspace_id: w.w1,
      data: { from: 'editor', to: 'viewer' },
    })
    // someone of the agency who is not in this workspace
    await expect(
      changeWorkspaceMemberRole(deps, owner, fresh(owner), member(w.w1, w.loose.id, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  test('removing a member revokes their sessions and audits it', async () => {
    const w = await world()
    // still in another workspace: a Manager may not leave a Member without any
    await seed(tdb.runtimeUrl, (s) => s.workspaceMember(w.orgA, w.w2, w.editor.id, 'viewer'))
    await signIn(w.editor.email)
    const manager = await actorOf(w.manager.id, w.orgA)
    await removeWorkspaceMember(
      deps,
      manager,
      fresh(manager),
      { workspaceId: w.w1, userId: w.editor.id },
      REQ,
    )
    expect(await workspaceRoleOf(w.w1, w.editor.id)).toBeUndefined()
    expect(await activeSessionsOf(w.editor.id)).toHaveLength(0)
    expect((await auditOf(w.orgA))[0]).toMatchObject({
      action: 'member.removed',
      actor_id: w.manager.id,
      entity_id: w.editor.id,
      workspace_id: w.w1,
      data: { role: 'editor' },
    })
    expect([...(await actorOf(w.editor.id, w.orgA)).memberships.keys()]).toEqual([w.w2])
    // nothing left to remove
    await expect(
      removeWorkspaceMember(
        deps,
        manager,
        fresh(manager),
        { workspaceId: w.w1, userId: w.editor.id },
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  test('roles and ids are checked at run time, and the session must be the actor’s', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await expect(
      addWorkspaceMember(
        deps,
        owner,
        fresh(owner),
        member(w.w1, w.loose.id, 'capo' as WorkspaceRole),
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(
      changeWorkspaceMemberRole(
        deps,
        owner,
        fresh(owner),
        member(w.w1, w.editor.id, 'owner' as WorkspaceRole),
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    const someoneElse = sessionOf(w.adminA.id, new Date())
    await expect(
      addWorkspaceMember(deps, owner, someoneElse, member(w.w1, w.loose.id, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    await expect(
      changeWorkspaceMemberRole(deps, owner, someoneElse, member(w.w1, w.editor.id, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    await expect(
      removeWorkspaceMember(
        deps,
        owner,
        someoneElse,
        { workspaceId: w.w1, userId: w.editor.id },
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  test('adding needs a recent reauth, also right after a removal', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await expect(
      addWorkspaceMember(deps, owner, stale(owner), member(w.w1, w.loose.id, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' })
    expect(await workspaceRoleOf(w.w1, w.loose.id)).toBeUndefined()
    // remove and add again must not stand in for a role change without reauth
    await removeWorkspaceMember(
      deps,
      owner,
      stale(owner),
      { workspaceId: w.w1, userId: w.editor.id },
      REQ,
    )
    await expect(
      addWorkspaceMember(deps, owner, stale(owner), member(w.w1, w.editor.id, 'manager'), REQ),
    ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' })
    expect(await workspaceRoleOf(w.w1, w.editor.id)).toBeUndefined()
    // a guessed workspace still answers NOT_FOUND, not REAUTH_REQUIRED
    await expect(
      addWorkspaceMember(deps, owner, stale(owner), member(w.wB, w.loose.id, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  test('a manager cannot leave a member without workspaces; owner and admin can', async () => {
    const w = await world()
    const manager = await actorOf(w.manager.id, w.orgA)
    await expect(
      removeWorkspaceMember(
        deps,
        manager,
        fresh(manager),
        { workspaceId: w.w1, userId: w.editor.id },
        REQ,
      ),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Resterebbe senza spazi: solo Owner e Admin possono toglierle l’ultimo spazio',
    })
    expect(await workspaceRoleOf(w.w1, w.editor.id)).toBe('editor')
    // a role in an archived workspace does not count
    const archived = await seed(tdb.runtimeUrl, async (s) => {
      const id = await s.workspace(w.orgA, { archived: true })
      await s.workspaceMember(w.orgA, id, w.editor.id, 'viewer')
      return id
    })
    await expect(
      removeWorkspaceMember(
        deps,
        manager,
        fresh(manager),
        { workspaceId: w.w1, userId: w.editor.id },
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await workspaceRoleOf(archived, w.editor.id)).toBe('viewer')
    const adminA = await actorOf(w.adminA.id, w.orgA)
    await removeWorkspaceMember(
      deps,
      adminA,
      fresh(adminA),
      { workspaceId: w.w1, userId: w.editor.id },
      REQ,
    )
    expect(await workspaceRoleOf(w.w1, w.editor.id)).toBeUndefined()
  })

  test('an admin cannot touch the workspace role the owner gave another admin', async () => {
    const w = await world()
    const otherAdmin = await person('altroadmin')
    await seed(tdb.runtimeUrl, (s) => s.member(w.orgA, otherAdmin.id, 'admin'))
    const owner = await actorOf(w.owner.id, w.orgA)
    await addWorkspaceMember(deps, owner, fresh(owner), member(w.w1, otherAdmin.id, 'viewer'), REQ)
    const adminA = await actorOf(w.adminA.id, w.orgA)
    await expect(
      changeWorkspaceMemberRole(
        deps,
        adminA,
        fresh(adminA),
        member(w.w1, otherAdmin.id, 'manager'),
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      removeWorkspaceMember(
        deps,
        adminA,
        fresh(adminA),
        { workspaceId: w.w1, userId: otherAdmin.id },
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await workspaceRoleOf(w.w1, otherAdmin.id)).toBe('viewer')
  })

  test('the owner gets no workspace role, not even from themselves', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    // can() never lets anyone act on the Owner, who sees every workspace anyway
    await expect(
      addWorkspaceMember(deps, owner, fresh(owner), member(w.w1, w.owner.id, 'manager'), REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const adminA = await actorOf(w.adminA.id, w.orgA)
    await expect(
      addWorkspaceMember(deps, adminA, fresh(adminA), member(w.w1, w.owner.id, 'viewer'), REQ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  test('accounts disabled on the platform or anonymized are not added', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    const anonymized = await person('anonimo')
    await seed(tdb.runtimeUrl, (s) => s.member(w.orgA, anonymized.id, 'member'))
    await admin.query("update users set status = 'disabled', disabled_at = now() where id = $1", [
      w.loose.id,
    ])
    await admin.query('update users set anonymized_at = now() where id = $1', [anonymized.id])
    for (const userId of [w.loose.id, anonymized.id])
      await expect(
        addWorkspaceMember(deps, owner, fresh(owner), member(w.w1, userId, 'viewer'), REQ),
      ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  test('the role of someone disabled in the agency does not change', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    await disableMember({ uow, clock: systemClock, auth }, owner, fresh(owner), w.editor.id, REQ)
    await expect(
      changeWorkspaceMemberRole(
        deps,
        owner,
        fresh(owner),
        member(w.w1, w.editor.id, 'viewer'),
        REQ,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await workspaceRoleOf(w.w1, w.editor.id)).toBe('editor')
    // the list says so
    expect(
      (await listWorkspaceMembers(deps, owner, w.w1)).find((m) => m.userId === w.editor.id),
    ).toMatchObject({ status: 'disabled' })
  })

  test('a manager cannot tell agency members from strangers', async () => {
    const w = await world()
    const manager = await actorOf(w.manager.id, w.orgA)
    const remove = (userId: string) =>
      removeWorkspaceMember(deps, manager, fresh(manager), { workspaceId: w.w1, userId }, REQ).then(
        () => null,
        (e: unknown) => e as { code: string; message: string },
      )
    // someone of the agency outside this workspace, and someone of another agency
    const inAgency = await remove(w.loose.id)
    const stranger = await remove(w.onlyB.id)
    expect(inAgency).toMatchObject({ code: 'NOT_FOUND' })
    expect(stranger).toMatchObject({ code: 'NOT_FOUND' })
    expect(inAgency?.message).toBe(stranger?.message)
  })

  test('the member list shows no secrets and only this workspace', async () => {
    const w = await world()
    const owner = await actorOf(w.owner.id, w.orgA)
    const list = await listWorkspaceMembers(deps, owner, w.w1)
    expect(list.map((m) => [m.userId, m.role]).sort()).toEqual(
      [
        [w.manager.id, 'manager'],
        [w.editor.id, 'editor'],
      ].sort(),
    )
    const json = JSON.stringify(list)
    for (const k of ['password', 'secret', 'token', 'hash', 'email']) expect(json).not.toContain(k)
    expect(await listWorkspaceMembers(deps, owner, w.w2)).toEqual([])
  })
})

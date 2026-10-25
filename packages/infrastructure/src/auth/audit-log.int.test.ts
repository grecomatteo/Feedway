import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  changeOrgRole,
  createWorkspace,
  listAuditLog,
  resolveOrgActor,
  type AuditItemDto,
  type AuthSessionInfo,
  type UnitOfWork,
} from '@app/application'
import type { OrgActor } from '@app/domain'
import { createDb, type Db } from '../db/client.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createLogger } from '../logging/logger.js'
import { systemClock } from '../system/clock.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { seed, startTestDatabase, withScope, type TestDatabase } from '../testing/index.js'

const REQ = { ip: '93.41.12.200' }

let tdb: TestDatabase
let admin: pg.Client
let db: Db
let uow: UnitOfWork
const logger = createLogger({ service: 'web', level: 'error' })

beforeAll(async () => {
  tdb = await startTestDatabase()
  db = createDb(tdb.runtimeUrl, { max: 4, applicationName: 'audit-log-test' }).db
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  uow = createUnitOfWork({ db, ids: uuidV7Generator, logger })
})
afterAll(async () => {
  await admin.end()
  await tdb.stop()
})

/** Agency A (two workspaces) and agency B, with one person per role. */
async function world() {
  return seed(tdb.runtimeUrl, async (s) => {
    const orgA = await s.organization()
    const orgB = await s.organization()
    const w1 = await s.workspace(orgA, { name: 'Alfa' })
    const w2 = await s.workspace(orgA, { name: 'Beta' })
    const wB = await s.workspace(orgB)
    const owner = await s.user({ name: 'Olga Titolare' })
    const adminA = await s.user({ name: 'Aldo Amministratore' })
    const manager = await s.user({ name: 'Marta Responsabile' })
    const publisher = await s.user({ name: 'Paolo Pubblica' })
    const loose = await s.user({ name: 'Livia Senzaspazi' })
    const onlyB = await s.user({
      name: 'Bruno Altraagenzia',
      email: `bruno-${randomUUID()}@b.test`,
    })
    await s.member(orgA, owner, 'owner')
    await s.member(orgA, adminA, 'admin')
    await s.member(orgA, manager, 'member')
    await s.workspaceMember(orgA, w1, manager, 'manager')
    await s.workspaceMember(orgA, w2, manager, 'viewer')
    await s.member(orgA, publisher, 'member')
    await s.workspaceMember(orgA, w1, publisher, 'publisher')
    await s.member(orgA, loose, 'member')
    await s.member(orgB, onlyB, 'owner')
    return { orgA, orgB, w1, w2, wB, owner, adminA, manager, publisher, loose, onlyB }
  })
}

/** Seed slugs are the agency ids. */
const actorOf = (userId: string, organizationId: string): Promise<OrgActor> =>
  resolveOrgActor({ uow }, { userId, organizationSlug: organizationId })

const deps = () => ({ uow })

interface Entry {
  organizationId: string | null
  actorId?: string | null
  action?: string
  source?: string
  workspaceId?: string | null
  createdAt?: string
  data?: Record<string, unknown>
  ip?: string | null
}
/** Written as the superuser, with a chosen time: the runtime role cannot set created_at. */
async function entry(e: Entry): Promise<string> {
  const id = uuidV7Generator.newId()
  await admin.query(
    `insert into audit_log (id, organization_id, actor_id, source, action, entity, entity_id,
                            workspace_id, ip, data, created_at)
     values ($1, $2, $3, $4, $5, 'workspace', null, $6, $7, $8, coalesce($9::timestamptz, now()))`,
    [
      id,
      e.organizationId,
      e.actorId ?? null,
      e.source ?? 'panel',
      e.action ?? 'workspace.renamed',
      e.workspaceId ?? null,
      e.ip ?? null,
      e.data ?? {},
      e.createdAt ?? null,
    ],
  )
  return id
}

async function allPages(actor: OrgActor, filter: Parameters<typeof listAuditLog>[2] = {}) {
  const pages: AuditItemDto[][] = []
  let cursor: string | undefined
  for (;;) {
    const page = await listAuditLog(deps(), actor, { ...filter, ...(cursor ? { cursor } : {}) })
    pages.push(page.items)
    if (page.nextCursor === null) return pages
    cursor = page.nextCursor
  }
}

function sessionOf(userId: string): AuthSessionInfo {
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
    reauthenticatedAt: now,
  }
}

describe('listAuditLog', () => {
  test('owner of A never sees entries of B, platform or personal entries', async () => {
    const w = await world()
    const mine = await entry({ organizationId: w.orgA, actorId: w.owner, workspaceId: w.w1 })
    await entry({ organizationId: w.orgB, actorId: w.onlyB, workspaceId: w.wB })
    // a personal entry of the owner is readable by them under row level security: the query
    // must still leave it out
    await entry({ organizationId: null, actorId: w.owner, action: 'auth.login' })
    await entry({
      organizationId: null,
      actorId: null,
      source: 'system',
      action: 'organization.suspended',
    })
    const owner = await actorOf(w.owner, w.orgA)
    const { items, nextCursor } = await listAuditLog(deps(), owner, {})
    expect(items.map((i) => i.id)).toEqual([mine])
    expect(items.every((i) => i.organizationId === w.orgA)).toBe(true)
    expect(items.map((i) => i.action)).not.toContain('auth.login')
    expect(nextCursor).toBeNull()
    // the other agency's workspace, a guessed id and a malformed one are not found
    for (const workspaceId of [w.wB, randomUUID(), 'non-un-uuid'])
      await expect(listAuditLog(deps(), owner, { workspaceId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
  })

  test('owner and admin see the whole agency and may filter by workspace', async () => {
    const w = await world()
    const e1 = await entry({ organizationId: w.orgA, actorId: w.manager, workspaceId: w.w1 })
    const e2 = await entry({ organizationId: w.orgA, actorId: w.owner, workspaceId: w.w2 })
    const e0 = await entry({ organizationId: w.orgA, actorId: w.owner, action: 'user.invited' })
    for (const id of [w.owner, w.adminA]) {
      const actor = await actorOf(id, w.orgA)
      expect((await listAuditLog(deps(), actor, {})).items.map((i) => i.id).sort()).toEqual(
        [e0, e1, e2].sort(),
      )
      expect(
        (await listAuditLog(deps(), actor, { workspaceId: w.w2 })).items.map((i) => i.id),
      ).toEqual([e2])
    }
  })

  test('manager sees only own workspace entries', async () => {
    const w = await world()
    await entry({ organizationId: w.orgA, actorId: w.owner, workspaceId: null })
    await entry({ organizationId: w.orgA, actorId: w.owner, workspaceId: w.w2 })
    const inW1 = [
      await entry({ organizationId: w.orgA, actorId: w.owner, workspaceId: w.w1 }),
      await entry({ organizationId: w.orgA, actorId: w.manager, workspaceId: w.w1 }),
    ]
    const manager = await actorOf(w.manager, w.orgA)
    const items = (await listAuditLog(deps(), manager, { workspaceId: w.w1 })).items
    expect(items.every((i) => i.workspaceId === w.w1)).toBe(true)
    expect(items.map((i) => i.id).sort()).toEqual(inW1.sort())
    await expect(listAuditLog(deps(), manager, {})).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // a workspace they only view: seen, but its log is not theirs
    await expect(listAuditLog(deps(), manager, { workspaceId: w.w2 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    // a workspace they do not see, of this agency or another
    const w3 = await seed(tdb.runtimeUrl, (s) => s.workspace(w.orgA))
    for (const workspaceId of [w3, w.wB])
      await expect(listAuditLog(deps(), manager, { workspaceId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
  })

  test('the manager still reads the log of an archived workspace', async () => {
    const w = await world()
    const e = await entry({ organizationId: w.orgA, actorId: w.owner, workspaceId: w.w1 })
    await admin.query('update workspaces set archived_at = now() where id = $1', [w.w1])
    const manager = await actorOf(w.manager, w.orgA)
    expect(
      (await listAuditLog(deps(), manager, { workspaceId: w.w1 })).items.map((i) => i.id),
    ).toEqual([e])
  })

  test('publisher and a member without workspaces cannot read the audit log', async () => {
    const w = await world()
    const publisher = await actorOf(w.publisher, w.orgA)
    const loose = await actorOf(w.loose, w.orgA)
    await expect(listAuditLog(deps(), publisher, {})).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(listAuditLog(deps(), publisher, { workspaceId: w.w1 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(listAuditLog(deps(), loose, {})).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(listAuditLog(deps(), loose, { workspaceId: w.w1 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  test('author names: nickname, name, Utente rimosso, Sistema, never someone of another agency', async () => {
    const w = await world()
    await admin.query(`update users set nickname = 'Marti' where id = $1`, [w.manager])
    await admin.query(
      `update users set anonymized_at = now(), name = 'Utente rimosso', email = $2 where id = $1`,
      [w.publisher, `anon-${randomUUID()}@anon.test`],
    )
    // someone outside the agency cannot be an author here today: the entry is forced in
    const ids = {
      nick: await entry({ organizationId: w.orgA, actorId: w.manager }),
      name: await entry({ organizationId: w.orgA, actorId: w.adminA }),
      anonymized: await entry({ organizationId: w.orgA, actorId: w.publisher }),
      system: await entry({ organizationId: w.orgA, actorId: null, source: 'system' }),
      stranger: await entry({ organizationId: w.orgA, actorId: w.onlyB }),
    }
    const owner = await actorOf(w.owner, w.orgA)
    const items = (await listAuditLog(deps(), owner, {})).items
    const byId = new Map(items.map((i) => [i.id, i]))
    expect(byId.get(ids.nick)).toMatchObject({ authorName: 'Marti', actorId: w.manager })
    expect(byId.get(ids.name)).toMatchObject({
      authorName: 'Aldo Amministratore',
      actorId: w.adminA,
    })
    expect(byId.get(ids.anonymized)).toMatchObject({ authorName: 'Utente rimosso' })
    expect(byId.get(ids.system)).toMatchObject({
      authorName: 'Sistema',
      actorId: null,
      source: 'system',
    })
    expect(byId.get(ids.stranger)).toMatchObject({ authorName: 'Utente rimosso', actorId: null })
    expect(JSON.stringify(items)).not.toContain('Bruno')
    // a disabled member still has their name on what they did
    await admin.query(
      `update organization_members set status = 'disabled' where organization_id = $1 and user_id = $2`,
      [w.orgA, w.adminA],
    )
    expect(
      (await listAuditLog(deps(), owner, {})).items.find((i) => i.id === ids.name),
    ).toMatchObject({ authorName: 'Aldo Amministratore' })
  })

  test('an entry from a use case: data as stored, no ip, no email', async () => {
    const w = await world()
    const owner = await actorOf(w.owner, w.orgA)
    const created = await createWorkspace(
      { uow, ids: uuidV7Generator },
      owner,
      { name: 'Gamma' },
      REQ,
    )
    await entry({
      organizationId: w.orgA,
      actorId: w.owner,
      action: 'member.role_changed',
      workspaceId: w.w1,
      data: { from: 'viewer', to: 'editor' },
      ip: '93.41.12.201',
    })
    const items = (await listAuditLog(deps(), owner, {})).items
    expect(items[0]).toMatchObject({
      action: 'member.role_changed',
      entity: 'workspace',
      data: { from: 'viewer', to: 'editor' },
      authorName: 'Olga Titolare',
    })
    expect(items[1]).toMatchObject({
      action: 'workspace.created',
      entity: 'workspace',
      entityId: created.id,
      workspaceId: created.id,
      source: 'panel',
      organizationId: w.orgA,
    })
    expect(typeof items[1]?.createdAt).toBe('string')
    const json = JSON.stringify(items)
    expect(json).not.toContain('93.41.12')
    expect(json).not.toContain('@')
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(
      [
        'action',
        'actorId',
        'authorName',
        'createdAt',
        'data',
        'entity',
        'entityId',
        'id',
        'organizationId',
        'source',
        'workspaceId',
      ].sort(),
    )
  })

  test('cursor pagination returns every entry once in order, ties on created_at included', async () => {
    const w = await world()
    // 120 entries on 30 instants, four per instant: the id breaks the tie
    const base = Date.parse('2026-10-01T08:00:00.000Z')
    for (let i = 0; i < 120; i++) {
      const at = new Date(base + Math.floor(i / 4) * 1000).toISOString()
      await entry({ organizationId: w.orgA, actorId: w.owner, workspaceId: w.w1, createdAt: at })
    }
    // and microseconds that a JavaScript date would round away
    await entry({
      organizationId: w.orgB,
      actorId: w.onlyB,
      createdAt: '2026-10-01T08:00:00.000001Z',
    })
    const owner = await actorOf(w.owner, w.orgA)
    const pages = await allPages(owner)
    expect(pages.map((p) => p.length)).toEqual([50, 50, 20])
    const ids = pages.flat().map((i) => i.id)
    expect(new Set(ids).size).toBe(120)
    const { rows } = await admin.query<{ id: string }>(
      'select id from audit_log where organization_id = $1 order by created_at desc, id desc',
      [w.orgA],
    )
    expect(ids).toEqual(rows.map((r) => r.id))
    // the manager walks the same entries in their workspace
    const manager = await actorOf(w.manager, w.orgA)
    expect(
      (await allPages(manager, { workspaceId: w.w1, limit: 7 })).flat().map((i) => i.id),
    ).toEqual(ids)
  })

  test('microsecond ties around a page boundary are neither lost nor repeated', async () => {
    const w = await world()
    const at = (us: string) => `2026-10-02T10:00:00.${us}Z`
    for (const us of ['000001', '000002', '000002', '000003', '000004', '000004'])
      await entry({ organizationId: w.orgA, actorId: w.owner, createdAt: at(us) })
    const owner = await actorOf(w.owner, w.orgA)
    const pages = await allPages(owner, { limit: 1 })
    const { rows } = await admin.query<{ id: string }>(
      'select id from audit_log where organization_id = $1 order by created_at desc, id desc',
      [w.orgA],
    )
    expect(pages.flat().map((i) => i.id)).toEqual(rows.map((r) => r.id))
  })

  test('a cursor from one agency gives nothing of another', async () => {
    const w = await world()
    for (let i = 0; i < 3; i++) await entry({ organizationId: w.orgA, actorId: w.owner })
    for (let i = 0; i < 3; i++) await entry({ organizationId: w.orgB, actorId: w.onlyB })
    const page = await listAuditLog(deps(), await actorOf(w.owner, w.orgA), { limit: 1 })
    expect(page.nextCursor).not.toBeNull()
    const ownerB = await actorOf(w.onlyB, w.orgB)
    const items = (
      await listAuditLog(deps(), ownerB, { cursor: page.nextCursor ?? '', limit: 100 })
    ).items
    expect(items.every((i) => i.organizationId === w.orgB)).toBe(true)
  })

  test('a tampered cursor is a validation error, never a database error', async () => {
    const w = await world()
    for (let i = 0; i < 3; i++) await entry({ organizationId: w.orgA, actorId: w.owner })
    const owner = await actorOf(w.owner, w.orgA)
    const good = (await listAuditLog(deps(), owner, { limit: 1 })).nextCursor ?? ''
    const b64 = (s: string) => Buffer.from(s).toString('base64url')
    const decoded = Buffer.from(good, 'base64url').toString()
    const [, id] = decoded.split('|')
    const bad: unknown[] = [
      '',
      'x',
      'not a cursor!',
      `${good}=`,
      `${good}AA`,
      b64('qualcosa'),
      b64(`2026-13-45T10:00:00.000000Z|${id ?? ''}`),
      b64(`2026-02-30T10:00:00.000000Z|${id ?? ''}`),
      b64(`0000-01-01T00:00:00.000000Z|${id ?? ''}`),
      b64(`2026-10-01T25:00:00.000000Z|${id ?? ''}`),
      b64(`2026-10-01T10:00:00.000000Z|non-un-uuid`),
      b64(`2026-10-01T10:00:00.000000Z|${id ?? ''}|extra`),
      b64(`2026-10-01T10:00:00Z|${id ?? ''}`),
      b64(`2026-10-01T10:00:00.000000Z|${id ?? ''}'; drop table audit_log; --`),
      'a'.repeat(10_000),
      42,
      null,
      {},
    ]
    for (const cursor of bad)
      await expect(
        listAuditLog(deps(), owner, { cursor } as unknown as { cursor: string }),
      ).rejects.toMatchObject({ code: 'VALIDATION' })
    // a well formed cursor nobody issued only places the page: still this agency's entries
    const forged = b64(`2030-01-01T00:00:00.000000Z|${randomUUID()}`)
    expect((await listAuditLog(deps(), owner, { cursor: forged })).items).toHaveLength(3)
  })

  test('filters: author, action, origin and dates', async () => {
    const w = await world()
    const t = (s: string) => `2026-10-03T${s}.000Z`
    const a = await entry({ organizationId: w.orgA, actorId: w.owner, createdAt: t('09:00:00') })
    const b = await entry({
      organizationId: w.orgA,
      actorId: w.adminA,
      action: 'user.invited',
      createdAt: t('10:00:00'),
    })
    const c = await entry({
      organizationId: w.orgA,
      actorId: null,
      source: 'system',
      createdAt: t('11:00:00'),
    })
    const owner = await actorOf(w.owner, w.orgA)
    const ids = async (filter: Parameters<typeof listAuditLog>[2]) =>
      (await listAuditLog(deps(), owner, filter)).items.map((i) => i.id)
    expect(await ids({ actorId: w.adminA })).toEqual([b])
    expect(await ids({ actorId: w.onlyB })).toEqual([])
    expect(await ids({ action: 'user.invited' })).toEqual([b])
    expect(await ids({ source: 'system' })).toEqual([c])
    // from inclusive, to exclusive
    expect(await ids({ from: new Date(t('10:00:00')) })).toEqual([c, b])
    expect(await ids({ to: new Date(t('10:00:00')) })).toEqual([a])
    expect(
      await ids({ from: new Date(t('09:00:00')), to: new Date(t('11:00:00')), limit: 1 }),
    ).toEqual([b])
    expect(await ids({ limit: 100 })).toEqual([c, b, a])
  })

  test('filter values are checked at run time', async () => {
    const w = await world()
    const owner = await actorOf(w.owner, w.orgA)
    const bad: Record<string, unknown>[] = [
      { actorId: 'non-un-uuid' },
      { actorId: 42 },
      { action: 'auth.qualcosa' },
      { action: ['user.invited'] },
      { source: 'cli' },
      { from: '2026-10-01' },
      { from: new Date('non una data') },
      { to: new Date('-010000-01-01T00:00:00Z') },
      { from: new Date('2026-10-02T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') },
      { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') },
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { limit: '10' },
      { limit: -1 },
    ]
    for (const filter of bad)
      await expect(
        listAuditLog(deps(), owner, filter as Parameters<typeof listAuditLog>[2]),
      ).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(
      listAuditLog(deps(), owner, { workspaceId: 42 } as unknown as { workspaceId: string }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  test('the default page holds 50 entries', async () => {
    const w = await world()
    for (let i = 0; i < 51; i++) await entry({ organizationId: w.orgA, actorId: w.owner })
    const page = await listAuditLog(deps(), await actorOf(w.owner, w.orgA), {})
    expect(page.items).toHaveLength(50)
    expect(page.nextCursor).not.toBeNull()
  })

  test('an actor demoted, disabled or taken out since it was built reads nothing', async () => {
    const w = await world()
    await entry({ organizationId: w.orgA, actorId: w.owner, workspaceId: w.w1 })
    const owner = await actorOf(w.owner, w.orgA)
    const adminA = await actorOf(w.adminA, w.orgA)
    const manager = await actorOf(w.manager, w.orgA)
    await changeOrgRole(
      { uow, clock: systemClock, auth: { revokeAllSessions: () => Promise.resolve(0) } },
      owner,
      sessionOf(w.owner),
      w.adminA,
      'member',
      REQ,
    )
    await expect(listAuditLog(deps(), adminA, {})).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await admin.query('delete from workspace_members where workspace_id = $1 and user_id = $2', [
      w.w1,
      w.manager,
    ])
    await expect(listAuditLog(deps(), manager, { workspaceId: w.w1 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await admin.query(
      `update organization_members set status = 'disabled' where organization_id = $1 and user_id = $2`,
      [w.orgA, w.manager],
    )
    await expect(listAuditLog(deps(), manager, { workspaceId: w.w1 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
      c.query("update organizations set status = 'suspended', suspended_at = now() where id = $1", [
        w.orgA,
      ]),
    )
    await expect(listAuditLog(deps(), owner, {})).rejects.toMatchObject({
      code: 'ORGANIZATION_SUSPENDED',
    })
  })
})

import { randomBytes, randomUUID } from 'node:crypto'
import type pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { shortenIp } from '@app/domain'
import { startTestDatabase, withScope } from '../../testing/index.js'
import type { Scope, TestDatabase } from '../../testing/index.js'

let tdb: TestDatabase
const SYSTEM: Scope = { kind: 'system' }
const asSystem = <T>(fn: (c: pg.Client) => Promise<T>) => withScope(tdb.runtimeUrl, SYSTEM, fn)
const inOrg = <T>(organizationId: string, fn: (c: pg.Client) => Promise<T>) =>
  withScope(tdb.runtimeUrl, { kind: 'organization', organizationId }, fn)
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000)

async function createUser() {
  const id = randomUUID()
  await asSystem((c) =>
    c.query('insert into users (id, name, email) values ($1, $2, $3)', [
      id,
      'Utente',
      `${id}@esempio.it`,
    ]),
  )
  return id
}

async function createOrganization() {
  const id = randomUUID()
  await asSystem((c) =>
    c.query('insert into organizations (id, name, slug) values ($1, $2, $3)', [id, 'Agenzia', id]),
  )
  return id
}

const addMember = (organizationId: string, userId: string, role: string) =>
  asSystem((c) =>
    c.query(
      'insert into organization_members (organization_id, user_id, role) values ($1, $2, $3)',
      [organizationId, userId, role],
    ),
  )

async function createWorkspace(organizationId: string) {
  const id = randomUUID()
  await asSystem((c) =>
    c.query('insert into workspaces (id, organization_id, name, slug) values ($1, $2, $3, $4)', [
      id,
      organizationId,
      'Spazio',
      id,
    ]),
  )
  return id
}

interface InviteFields {
  purpose: string
  organizationId: string | null
  existingUserId?: string
  reservedUserId?: string
}
const insertInvite = (f: InviteFields) =>
  asSystem((c) =>
    c.query(
      `insert into invites (id, organization_id, purpose, email, existing_user_id, reserved_user_id,
                            token_hash, expires_at)
       values ($1, $2, $3, 'nuovo@esempio.it', $4, $5, $6, now() + interval '1 hour')`,
      [
        randomUUID(),
        f.organizationId,
        f.purpose,
        f.existingUserId ?? null,
        f.reservedUserId ?? null,
        randomBytes(32),
      ],
    ),
  )

async function insertAuditAsSystem(f: { action?: string; ip?: string; createdAt?: Date }) {
  const id = randomUUID()
  await asSystem((c) =>
    c.query(
      `insert into audit_log (id, source, action, ip, created_at)
       values ($1, 'system', $2, $3, coalesce($4, now()))`,
      [id, f.action ?? 'test', f.ip ?? null, f.createdAt ?? null],
    ),
  )
  return id
}

const shortenIps = async (c: pg.Client, before: Date) =>
  (await c.query<{ n: number }>('select audit_shorten_ips($1) as n', [before])).rows[0]?.n

let orgA: string
let orgB: string
beforeAll(async () => {
  tdb = await startTestDatabase()
  orgA = await createOrganization()
  orgB = await createOrganization()
}, 120_000)
afterAll(async () => {
  await tdb.stop()
})

test('only one owner per organization', async () => {
  const [u1, u2] = [await createUser(), await createUser()]
  await addMember(orgA, u1, 'owner')
  await expect(addMember(orgA, u2, 'owner')).rejects.toThrow(/unique/)
  await expect(addMember(orgA, u2, 'admin')).resolves.toBeDefined()
})

test('roles and statuses are enforced', async () => {
  const u = await createUser()
  await expect(addMember(orgB, u, 'superadmin')).rejects.toThrow(/check/)
})

test('workspace member must reference a workspace of the same organization', async () => {
  const u1 = await createUser()
  await addMember(orgA, u1, 'member')
  const workspaceOfB = await createWorkspace(orgB)
  await expect(
    asSystem((c) =>
      c.query(
        `insert into workspace_members (organization_id, workspace_id, user_id, role)
         values ($1, $2, $3, 'editor')`,
        [orgA, workspaceOfB, u1],
      ),
    ),
  ).rejects.toThrow(/foreign key/)
})

test('workspace member must be a member of the organization', async () => {
  const outsider = await createUser()
  const workspaceOfA = await createWorkspace(orgA)
  await expect(
    asSystem((c) =>
      c.query(
        `insert into workspace_members (organization_id, workspace_id, user_id, role)
         values ($1, $2, $3, 'editor')`,
        [orgA, workspaceOfA, outsider],
      ),
    ),
  ).rejects.toThrow(/foreign key/)
})

test('workspace slugs are unique inside an organization only', async () => {
  const slug = `spazio-${randomUUID()}`
  const insert = (organizationId: string) =>
    asSystem((c) =>
      c.query('insert into workspaces (id, organization_id, name, slug) values ($1, $2, $3, $4)', [
        randomUUID(),
        organizationId,
        'Spazio',
        slug,
      ]),
    )
  await insert(orgA)
  await expect(insert(orgB)).resolves.toBeDefined()
  await expect(insert(orgA)).rejects.toThrow(/unique/)
})

test('only bootstrap invites may lack an organization', async () => {
  await expect(insertInvite({ purpose: 'invite', organizationId: null })).rejects.toThrow(/check/)
  await expect(insertInvite({ purpose: 'bootstrap', organizationId: null })).resolves.toBeDefined()
})

test('an invite cannot carry both an existing and a reserved user', async () => {
  await expect(
    insertInvite({
      purpose: 'invite',
      organizationId: orgA,
      existingUserId: randomUUID(),
      reservedUserId: randomUUID(),
    }),
  ).rejects.toThrow(/check/)
})

test('runtime role cannot update or delete audit log', async () => {
  const id = await insertAuditAsSystem({ action: 'test' })
  await expect(
    asSystem((c) => c.query('update audit_log set action = $1 where id = $2', ['x', id])),
  ).rejects.toThrow(/permission denied/)
  await expect(
    asSystem((c) => c.query('delete from audit_log where id = $1', [id])),
  ).rejects.toThrow(/permission denied/)
})

test('old audit ips are shortened only in system scope and only once', async () => {
  const v4 = await insertAuditAsSystem({ ip: '93.41.12.200', createdAt: daysAgo(91) })
  const v6 = await insertAuditAsSystem({ ip: '2001:db8:abcd:12::1', createdAt: daysAgo(91) })
  const recent = await insertAuditAsSystem({ ip: '93.41.12.201', createdAt: daysAgo(89) })
  // entries without an agency: agency B cannot touch them
  expect(await inOrg(orgB, (c) => shortenIps(c, daysAgo(90)))).toBe(0)
  expect(await asSystem((c) => shortenIps(c, daysAgo(90)))).toBe(2)
  expect(await asSystem((c) => shortenIps(c, daysAgo(90)))).toBe(0)

  const host = async (id: string) =>
    (
      await asSystem((c) =>
        c.query<{ h: string }>('select host(ip) as h from audit_log where id = $1', [id]),
      )
    ).rows[0]?.h
  // host(ip): the /24 or /48 mask stays in the inet column
  expect(await host(v4)).toBe(shortenIp('93.41.12.200'))
  expect(await host(v6)).toBe(shortenIp('2001:db8:abcd:12::1'))
  expect(await host(recent)).toBe('93.41.12.201')
})

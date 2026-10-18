import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestDatabase, withScope } from '../testing/index.js'
import type { TestDatabase } from '../testing/index.js'

// Everything here runs as app_runtime, the role the application uses.
let tdb: TestDatabase
let runtime: pg.Pool
type Fn<T> = (c: pg.Client) => Promise<T>
const asSystem = <T>(fn: Fn<T>) => withScope(tdb.runtimeUrl, { kind: 'system' }, fn)
const inOrg = <T>(organizationId: string, fn: Fn<T>) =>
  withScope(tdb.runtimeUrl, { kind: 'organization', organizationId }, fn)
const asUser = <T>(userId: string, fn: Fn<T>) =>
  withScope(tdb.runtimeUrl, { kind: 'user', userId }, fn)
const newId = () => randomUUID()

const shares = async (c: pg.Client, a: string, b: string) =>
  (await c.query<{ r: boolean }>('select shares_active_organization($1, $2) as r', [a, b])).rows[0]
    ?.r
const orgCount = async (c: pg.Client, u: string) =>
  (await c.query<{ n: number }>('select organization_count($1) as n', [u])).rows[0]?.n
const insertPersonalAudit = (c: pg.Client, actorId: string) =>
  c.query(
    `insert into audit_log (id, organization_id, actor_id, source, action)
     values ($1, null, $2, 'panel', 'account.updated')`,
    [newId(), actorId],
  )
const setOrgStatus = (id: string, status: string) =>
  asSystem((c) => c.query('update organizations set status = $1 where id = $2', [status, id]))
const setMemberStatus = (organizationId: string, userId: string, status: string) =>
  asSystem((c) =>
    c.query(
      'update organization_members set status = $1 where organization_id = $2 and user_id = $3',
      [status, organizationId, userId],
    ),
  )

// u1 active in A; u2 active in A and B; u3 only in B; u4 disabled in A; u5 in no agency
const orgA = newId()
const orgB = newId()
const [u1, u2, u3, u4, u5] = [newId(), newId(), newId(), newId(), newId()]

beforeAll(async () => {
  tdb = await startTestDatabase()
  runtime = new pg.Pool({ connectionString: tdb.runtimeUrl, max: 2 })
  await asSystem(async (c) => {
    for (const u of [u1, u2, u3, u4, u5]) {
      await c.query('insert into users (id, name, email) values ($1, $2, $3)', [
        u,
        'Utente',
        `${u}@esempio.it`,
      ])
    }
    for (const o of [orgA, orgB]) {
      await c.query('insert into organizations (id, name, slug) values ($1, $2, $3)', [o, 'Ag', o])
      await c.query(
        'insert into workspaces (id, organization_id, name, slug) values ($1, $2, $3, $4)',
        [newId(), o, 'Spazio', 'spazio'],
      )
    }
    const members: [string, string, string][] = [
      [orgA, u1, 'active'],
      [orgA, u2, 'active'],
      [orgB, u2, 'active'],
      [orgB, u3, 'active'],
      [orgA, u4, 'disabled'],
    ]
    for (const [o, u, status] of members) {
      await c.query(
        `insert into organization_members (organization_id, user_id, role, status)
         values ($1, $2, 'member', $3)`,
        [o, u, status],
      )
    }
    // one row of agency A in every isolated table, so the "no context" test cannot pass empty
    const wsA = newId()
    await c.query(
      `insert into workspaces (id, organization_id, name, slug) values ($1, $2, 'Altro', 'altro')`,
      [wsA, orgA],
    )
    await c.query(
      `insert into workspace_members (organization_id, workspace_id, user_id, role)
       values ($1, $2, $3, 'editor')`,
      [orgA, wsA, u1],
    )
    await c.query(
      `insert into organization_keys (organization_id, version, key_enc) values ($1, 1, 'v1.1.x')`,
      [orgA],
    )
    await c.query(
      `insert into invites (id, organization_id, purpose, email, token_hash, expires_at)
       values ($1, $2, 'invite', 'nuovo@esempio.it', $3, now() + interval '1 day')`,
      [newId(), orgA, Buffer.from(newId())],
    )
    await c.query(
      `insert into api_tokens (id, organization_id, user_id, name, token_hash)
       values ($1, $2, $3, 'cli', $4)`,
      [newId(), orgA, u1, Buffer.from(newId())],
    )
    await c.query(
      `insert into audit_log (id, organization_id, actor_id, source, action)
       values ($1, $2, $3, 'panel', 'workspace.created')`,
      [newId(), orgA, u1],
    )
  })
}, 120_000)
afterAll(async () => {
  await runtime.end()
  await tdb.stop()
})

test('without context no tenant rows are visible', async () => {
  const tables = [
    'organizations',
    'organization_members',
    'organization_keys',
    'invites',
    'workspaces',
    'workspace_members',
    'audit_log',
    'api_tokens',
  ]
  for (const t of tables) {
    expect((await runtime.query(`select * from ${t}`)).rowCount, t).toBe(0)
    expect((await asSystem((c) => c.query(`select * from ${t}`))).rowCount, t).toBeGreaterThan(0)
  }
})

test('org A context sees only org A rows even without WHERE', async () => {
  const rows = await inOrg(orgA, (c) =>
    c.query<{ organization_id: string }>('select organization_id from workspaces'),
  )
  expect(rows.rowCount).toBeGreaterThan(0)
  expect(rows.rows.every((r) => r.organization_id === orgA)).toBe(true)
})

test('org A context cannot insert or update rows of org B', async () => {
  await expect(
    inOrg(orgA, (c) =>
      c.query('insert into workspaces(id, organization_id, name, slug) values ($1, $2, $3, $4)', [
        newId(),
        orgB,
        'x',
        'x',
      ]),
    ),
  ).rejects.toThrow(/row-level security/)
  const updated = await inOrg(orgA, (c) =>
    c.query('update workspaces set name = $1 where organization_id = $2', ['hack', orgB]),
  )
  expect(updated.rowCount).toBe(0)
  // moving an own row into another agency is refused too
  await expect(
    inOrg(orgA, (c) =>
      c.query('update workspaces set organization_id = $1 where organization_id = $2', [
        orgB,
        orgA,
      ]),
    ),
  ).rejects.toThrow(/row-level security|foreign key/)
})

test('user sees all own memberships for the switcher', async () => {
  const rows = await asUser(u2, (c) => c.query('select organization_id from organization_members'))
  expect(rows.rowCount).toBe(2)
})

test('user writes and reads only own personal audit entries', async () => {
  await asUser(u1, (c) => insertPersonalAudit(c, u1))
  await expect(asUser(u1, (c) => insertPersonalAudit(c, u2))).rejects.toThrow(/row-level security/)
  expect((await asUser(u1, (c) => c.query('select * from audit_log'))).rowCount).toBe(1)
  expect((await asUser(u2, (c) => c.query('select * from audit_log'))).rowCount).toBe(0)
})

test('shares_active_organization answers across agencies from a user-only scope', async () => {
  expect(await asUser(u1, (c) => shares(c, u1, u2))).toBe(true)
  expect(await asUser(u1, (c) => shares(c, u1, u3))).toBe(false)
  expect(await asUser(u1, (c) => shares(c, u1, u4))).toBe(false)
  expect(await inOrg(orgB, (c) => shares(c, u3, u2))).toBe(true)
  await setOrgStatus(orgA, 'suspended')
  try {
    expect(await asUser(u1, (c) => shares(c, u1, u2))).toBe(false)
  } finally {
    await setOrgStatus(orgA, 'active')
  }
})

test('organization_count counts every agency of a user from an org scope, disabled memberships included', async () => {
  expect(await inOrg(orgA, (c) => orgCount(c, u2))).toBe(2)
  expect(await inOrg(orgA, (c) => orgCount(c, u4))).toBe(1)
  expect(await inOrg(orgA, (c) => orgCount(c, u5))).toBe(0)
  await setMemberStatus(orgB, u2, 'disabled')
  try {
    expect(await inOrg(orgA, (c) => orgCount(c, u2))).toBe(2)
  } finally {
    await setMemberStatus(orgB, u2, 'active')
  }
})

test('the functions do not leak the system scope and are owned by the migrator with a fixed search_path', async () => {
  const visible = await asUser(u1, async (c) => {
    await shares(c, u1, u2)
    await orgCount(c, u2)
    const scope = (
      await c.query<{ s: string | null }>(`select current_setting('app.scope', true) as s`)
    ).rows[0]?.s
    const n = (await c.query<{ n: number }>('select count(*)::int as n from organization_members'))
      .rows[0]?.n
    return { scope, n }
  })
  expect(visible).toEqual({ scope: '', n: 1 })
  const fns = await runtime.query<{
    proname: string
    owner: string
    prosecdef: boolean
    proconfig: string[]
  }>(
    `select proname, pg_get_userbyid(proowner) as owner, prosecdef, proconfig from pg_proc
      where proname in ('shares_active_organization', 'organization_count', 'audit_shorten_ips')`,
  )
  expect(fns.rowCount).toBe(3)
  for (const f of fns.rows) {
    expect(f.owner, f.proname).toBe('app_migrator')
    expect(f.prosecdef, f.proname).toBe(true)
    expect(f.proconfig, f.proname).toEqual(
      expect.arrayContaining(['search_path=pg_catalog, public']),
    )
  }
})

test('an agency renames itself but cannot suspend, unsuspend, delete or re-limit itself', async () => {
  const renamed = await inOrg(orgB, (c) =>
    c.query(`update organizations set name = 'Agenzia B' where id = $1`, [orgB]),
  )
  expect(renamed.rowCount).toBe(1)
  for (const change of [
    `status = 'suspended'`,
    `suspended_at = now()`,
    `limits = '{"workspaces": 999}'`,
    `slug = 'altro'`,
  ]) {
    await expect(
      inOrg(orgB, (c) => c.query(`update organizations set ${change} where id = $1`, [orgB])),
      change,
    ).rejects.toThrow(/system scope/)
  }
  const deleted = await inOrg(orgB, (c) =>
    c.query('delete from organizations where id = $1', [orgB]),
  )
  expect(deleted.rowCount).toBe(0)

  await setOrgStatus(orgB, 'suspended')
  try {
    await expect(
      inOrg(orgB, (c) =>
        c.query(`update organizations set status = 'active' where id = $1`, [orgB]),
      ),
    ).rejects.toThrow(/system scope/)
  } finally {
    await setOrgStatus(orgB, 'active')
  }
})

test('an agency sees only its own row in organizations, a user sees the agencies they belong to', async () => {
  const own = await inOrg(orgA, (c) => c.query<{ id: string }>('select id from organizations'))
  expect(own.rows.map((r) => r.id)).toEqual([orgA])
  expect((await asUser(u2, (c) => c.query('select id from organizations'))).rowCount).toBe(2)
  await expect(
    inOrg(orgA, (c) =>
      c.query(`insert into organizations(id, name, slug) values ($1, 'x', 'x')`, [newId()]),
    ),
  ).rejects.toThrow(/row-level security/)
  const updated = await inOrg(orgA, (c) =>
    c.query(`update organizations set name = 'hack' where id = $1`, [orgB]),
  )
  expect(updated.rowCount).toBe(0)
  // a member reads the list but cannot change an agency
  const byUser = await asUser(u2, (c) => c.query(`update organizations set name = 'hack'`))
  expect(byUser.rowCount).toBe(0)
})

test('system scope sees everything', async () => {
  const rows = await asSystem((c) => c.query('select distinct organization_id from workspaces'))
  expect(rows.rowCount).toBe(2)
})

test('runtime role does not bypass RLS', async () => {
  const { rows } = await runtime.query<{ rolbypassrls: boolean }>(
    `select rolbypassrls from pg_roles where rolname = 'app_runtime'`,
  )
  expect(rows[0]?.rolbypassrls).toBe(false)
})

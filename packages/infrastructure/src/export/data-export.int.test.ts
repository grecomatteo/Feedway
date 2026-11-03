import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import {
  buildDataExport,
  DATA_EXPORT_STALE_MS,
  listDataExports,
  openDataExport,
  requestDataExport,
  type AuthSessionInfo,
  type DataExportJobDeps,
  type JobPayloads,
  type JobQueue,
  type Logger,
  type Storage,
  type UnitOfWork,
} from '@app/application'
import { DomainError } from '@app/domain'
import { createDb, type DbHandle } from '../db/client.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createLocalDiskStorage } from '../storage/local-disk-storage.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { fixedClock, seed, startTestDatabase, type TestDatabase } from '../testing/index.js'
import { createZipWriter } from './zip-writer.js'

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
}
const DAY = 24 * 3600_000

let tdb: TestDatabase
let handle: DbHandle
let admin: pg.Client
let root: string
let storage: Storage
let uow: UnitOfWork
let clock: ReturnType<typeof fixedClock>
const sent: JobPayloads['identity.data_export'][] = []
const queue: Pick<JobQueue, 'send'> = {
  send: (name, data) => {
    if (name === 'identity.data_export') sent.push(data as JobPayloads['identity.data_export'])
    return Promise.resolve(randomUUID())
  },
}
let orgA: string, orgB: string, orgC: string
let user: string, colleague: string, stranger: string
let workspaceA: string

const SECRETS = {
  password: '$argon2id$v=19$m=19456,t=2,p=1$c2VjcmV0LXNhbHQ$aGFzaC1vZi10aGUtcGFzc3dvcmQ',
  totp: 'TOTPSECRETDONOTLEAK',
  backupCodes: 'backup-code-1,backup-code-2',
  sessionToken: 'session-token-do-not-leak',
  publicKey: 'passkey-public-key-do-not-leak',
  credentialId: 'passkey-credential-id-do-not-leak',
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 4, applicationName: 'data-export-test' })
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  root = await mkdtemp(join(tmpdir(), 'data-export-test-'))
  storage = createLocalDiskStorage({ root })
  uow = createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger: silent })
  await seed(tdb.runtimeUrl, async (s) => {
    orgA = await s.organization()
    orgB = await s.organization()
    orgC = await s.organization()
    user = await s.user({ name: 'Giulia Bianchi', email: 'giulia@example.test' })
    colleague = await s.user()
    stranger = await s.user()
    await s.member(orgA, user, 'admin')
    await s.member(orgB, user, 'member')
    await s.member(orgA, colleague, 'member')
    await s.member(orgC, stranger, 'owner')
    workspaceA = await s.workspace(orgA, { name: 'Caffè Roma' })
    await s.workspaceMember(orgA, workspaceA, user, 'editor')
    await s.workspace(orgC, { name: 'Cliente di C' })
  })
  for (const [id, name] of [
    [orgA, 'Agenzia A'],
    [orgB, 'Agenzia B'],
    [orgC, 'Agenzia C'],
  ] as const)
    await admin.query('update organizations set name = $2 where id = $1', [id, name])

  // credentials whose secrets must never reach the archive
  await admin.query(
    `insert into accounts (id, account_id, provider_id, user_id, password, updated_at)
     values ($1, $2::text, 'credential', $3::uuid, $4, now())`,
    [randomUUID(), user, user, SECRETS.password],
  )
  await admin.query(
    `insert into two_factors (id, secret, backup_codes, user_id) values ($1, $2, $3, $4)`,
    [randomUUID(), SECRETS.totp, SECRETS.backupCodes, user],
  )
  await admin.query('update users set two_factor_enabled = true where id = $1', [user])
  await admin.query(
    `insert into sessions (id, expires_at, token, user_id, ip_address, user_agent, updated_at)
     values ($1, now() + interval '1 day', $2, $3, '203.0.113.7', 'Firefox su Linux', now())`,
    [randomUUID(), SECRETS.sessionToken, user],
  )
  await admin.query(
    `insert into passkeys (id, name, public_key, user_id, credential_id, counter, device_type,
                           backed_up, created_at)
     values ($1, 'Portatile', $2, $3, $4, 0, 'multiDevice', true, now())`,
    [randomUUID(), SECRETS.publicKey, user, SECRETS.credentialId],
  )
  await admin.query(
    `insert into known_devices (user_id, device_hash) values ($1, '\\xdeadbeef'::bytea)`,
    [user],
  )

  // activity: the person's own in A, B and their account; a colleague's in A; a stranger's in C
  const entry = (org: string | null, actor: string, action: string) =>
    admin.query(
      `insert into audit_log (id, organization_id, actor_id, source, action, ip)
       values ($1, $2, $3, 'panel', $4, '198.51.100.4')`,
      [randomUUID(), org, actor, action],
    )
  await entry(orgA, user, 'workspace.renamed')
  await entry(orgB, user, 'member.role_changed')
  await entry(null, user, 'user.profile_updated')
  await entry(orgA, colleague, 'workspace.archived')
  await entry(orgC, stranger, 'workspace.created')
})

afterAll(async () => {
  await admin.end()
  await handle.close()
  await tdb.stop()
  await rm(root, { recursive: true, force: true })
})

beforeEach(async () => {
  clock = fixedClock(new Date())
  sent.length = 0
  await admin.query('delete from data_exports')
})

const requestDeps = () => ({ uow, queue, clock, ids: uuidV7Generator })
const IP = '192.0.2.10'
/** A session confirmed with the password just now. */
const sessionOf = (
  userId: string,
  reauthenticatedAt: Date | null = clock.now(),
): AuthSessionInfo => ({
  id: randomUUID(),
  userId,
  createdAt: clock.now(),
  expiresAt: new Date(clock.now().getTime() + DAY),
  updatedAt: clock.now(),
  ipAddress: IP,
  userAgent: null,
  authMethod: 'password',
  reauthenticatedAt,
})
const request = (userId: string) =>
  requestDataExport(requestDeps(), { id: userId }, sessionOf(userId), { ip: IP })
const open = (userId: string, id: string) =>
  openDataExport({ uow, storage, clock }, { id: userId }, sessionOf(userId), id)
const jobDeps = (): DataExportJobDeps => ({
  uow,
  storage,
  clock,
  zip: createZipWriter(),
  logger: silent,
})

async function bytesOf(object: { body: AsyncIterable<Uint8Array> }) {
  const chunks: Uint8Array[] = []
  for await (const c of object.body) chunks.push(c)
  return Buffer.concat(chunks)
}

async function exportFor(userId: string) {
  const dto = await request(userId)
  const job = sent.at(-1)
  if (!job) throw new Error('no job queued')
  await buildDataExport(jobDeps(), job)
  const { object } = await open(userId, dto.id)
  return { id: dto.id, files: unzipSync(await bytesOf(object)) }
}

const text = (files: Record<string, Uint8Array>, name: string) => {
  const file = files[name]
  if (!file) throw new Error(`${name} missing`)
  return new TextDecoder().decode(file)
}
/** One JSON file of the archive, with the shape the test expects of it. */
const json = (files: Record<string, Uint8Array>, name: string): unknown =>
  JSON.parse(text(files, name))

interface Agency {
  id: string
  agenzia: string
}
interface Activity {
  agenzia: string | null
  idAutore: string
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    if (error instanceof DomainError) return error.code
    throw error
  }
  return 'OK'
}

test('export holds own data from every agency and nothing of others', async () => {
  const { files } = await exportFor(user)
  expect(Object.keys(files).sort()).toEqual([
    'LEGGIMI.txt',
    'agenzie.json',
    'attivita.json',
    'profilo.json',
    'sicurezza.json',
  ])
  expect(json(files, 'profilo.json')).toMatchObject({
    id: user,
    nome: 'Giulia Bianchi',
    email: 'giulia@example.test',
    fotoProfilo: false,
  })
  const agencies = json(files, 'agenzie.json') as Agency[]
  expect(agencies.map((a) => a.agenzia).sort()).toEqual(['Agenzia A', 'Agenzia B'])
  expect(agencies.find((a) => a.id === orgA)).toMatchObject({
    ruolo: 'admin',
    clienti: [{ id: workspaceA, nome: 'Caffè Roma', ruolo: 'editor', archiviato: false }],
  })
  const activity = json(files, 'attivita.json') as Activity[]
  expect(activity).toHaveLength(3)
  expect(new Set(activity.map((a) => a.agenzia))).toEqual(new Set(['Agenzia A', 'Agenzia B', null]))
  expect(activity.every((a) => a.idAutore === user)).toBe(true)
  expect(activity[0]).toMatchObject({ indirizzoIp: '198.51.100.4' })
  const all = Object.keys(files)
    .map((name) => text(files, name))
    .join('\n')
  expect(all).not.toContain('Agenzia C')
  expect(all).not.toContain('Cliente di C')
  expect(all).not.toContain('workspace.archived')
  expect(all).not.toContain(colleague)
})

test('export never contains secrets', async () => {
  const { files } = await exportFor(user)
  const security = json(files, 'sicurezza.json') as { dispositiviRiconosciuti: unknown[] }
  expect(security).toMatchObject({
    appDiAutenticazione: true,
    passkey: [{ nome: 'Portatile', tipo: 'sincronizzata' }],
    sessioni: [{ indirizzoIp: '203.0.113.7', dispositivo: 'Firefox su Linux', metodo: 'password' }],
  })
  expect(security.dispositiviRiconosciuti).toHaveLength(1)
  const all = Object.keys(files)
    .map((name) => text(files, name))
    .join('\n')
  for (const secret of [
    SECRETS.password,
    SECRETS.totp,
    'backup-code-1',
    SECRETS.sessionToken,
    SECRETS.publicKey,
    SECRETS.credentialId,
    'deadbeef',
  ])
    expect(all).not.toContain(secret)
})

test('photo is included when present', async () => {
  const key = `users/${colleague}/avatar/${'a'.repeat(64)}`
  const photo = Buffer.from('RIFF....WEBPVP8 fake photo bytes')
  await storage.put(`${key}.webp`, photo, { contentType: 'image/webp' })
  await admin.query('update users set avatar_key = $2 where id = $1', [colleague, key])
  const { files } = await exportFor(colleague)
  expect(Buffer.from(files['foto/avatar-256.webp'] ?? [])).toEqual(photo)
  expect(json(files, 'profilo.json')).toMatchObject({ fotoProfilo: true })
})

test('download works for 24 hours, only for the owner', async () => {
  const { id } = await exportFor(user)
  const [listed] = await listDataExports({ uow, clock }, { id: user })
  expect(listed).toMatchObject({ id, status: 'ready' })
  expect(new Date(listed?.expiresAt ?? 0).getTime()).toBe(clock.now().getTime() + DAY)
  expect(await codeOf(open(colleague, id))).toBe('NOT_FOUND')
  expect(await codeOf(open(user, 'not-an-id'))).toBe('NOT_FOUND')
  clock.advance(DAY + 60_000)
  expect(await codeOf(open(user, id))).toBe('LINK_INVALID')
  expect((await listDataExports({ uow, clock }, { id: user }))[0]).toMatchObject({
    status: 'expired',
  })
})

test('a fourth request in 24 hours is limited', async () => {
  for (let i = 0; i < 3; i++) {
    const dto = await request(user)
    await buildDataExport(jobDeps(), { userId: user, exportId: dto.id, ip: IP })
  }
  expect(await codeOf(request(user))).toBe('RATE_LIMITED')
  clock.advance(DAY + 1000)
  expect(await codeOf(request(user))).toBe('OK')
})

test('a pending export is returned instead of a new one', async () => {
  const first = await request(user)
  const second = await request(user)
  expect(second.id).toBe(first.id)
  expect(sent).toHaveLength(1)
  expect(await codeOf(open(user, first.id))).toBe('CONFLICT')
})

test('two requests at once make one export', async () => {
  const [a, b] = await Promise.all([request(user), request(user)])
  expect(a.id).toBe(b.id)
  expect(sent).toHaveLength(1)
})

test('the archive goes under the person and a personal entry records it', async () => {
  const older = await exportFor(user)
  const { id } = await exportFor(user)
  // only the newest archive stays
  expect(
    (await listDataExports({ uow, clock }, { id: user })).map((e) => [e.id, e.status]),
  ).toEqual([
    [id, 'ready'],
    [older.id, 'expired'],
  ])
  expect((await storage.list(`users/${user}/exports/`)).map((o) => o.key)).toEqual([
    `users/${user}/exports/${id}.zip`,
  ])
  const { rows } = await admin.query<{ source: string; ip: string }>(
    `select source, host(ip) as ip from audit_log
      where action = 'user.data_exported' and actor_id = $1 and organization_id is null`,
    [user],
  )
  expect(rows.length).toBeGreaterThan(0)
  // the request's address, not the worker's
  expect(rows[0]).toEqual({ source: 'panel', ip: IP })
})

test('a job for an export already done does nothing; a failure marks it failed', async () => {
  const { id } = await exportFor(user)
  await buildDataExport(jobDeps(), { userId: user, exportId: id, ip: IP })
  expect((await listDataExports({ uow, clock }, { id: user }))[0]?.status).toBe('ready')

  const dto = await request(colleague)
  const broken: DataExportJobDeps = {
    ...jobDeps(),
    zip: {
      create: () => {
        throw new Error('disk full')
      },
    },
  }
  await buildDataExport(broken, { userId: colleague, exportId: dto.id, ip: IP })
  expect((await listDataExports({ uow, clock }, { id: colleague }))[0]?.status).toBe('failed')
  // a failed one does not block a new request
  expect((await request(colleague)).id).not.toBe(dto.id)
})

test('a job for an export not yet committed is retried', async () => {
  await expect(
    buildDataExport(jobDeps(), { userId: user, exportId: uuidV7Generator.newId(), ip: IP }),
  ).rejects.toThrow()
})

test('asking for the data or downloading it needs a recent password confirmation', async () => {
  const { id } = await exportFor(user)
  const unconfirmed = sessionOf(user, null)
  expect(
    await codeOf(requestDataExport(requestDeps(), { id: user }, unconfirmed, { ip: IP })),
  ).toBe('REAUTH_REQUIRED')
  expect(await codeOf(openDataExport({ uow, storage, clock }, { id: user }, unconfirmed, id))).toBe(
    'REAUTH_REQUIRED',
  )
  const old = sessionOf(user, new Date(clock.now().getTime() - 3600_000))
  expect(await codeOf(openDataExport({ uow, storage, clock }, { id: user }, old, id))).toBe(
    'REAUTH_REQUIRED',
  )
})

test('an export stuck in preparation lets the person ask again', async () => {
  const stuck = await request(colleague)
  clock.advance(DATA_EXPORT_STALE_MS + 60_000)
  expect((await listDataExports({ uow, clock }, { id: colleague }))[0]).toMatchObject({
    id: stuck.id,
    status: 'failed',
  })
  const next = await request(colleague)
  expect(next.id).not.toBe(stuck.id)
  expect(next.status).toBe('pending')
})

test('a second run of the same job does not build it again', async () => {
  const dto = await request(colleague)
  const job = { userId: colleague, exportId: dto.id, ip: IP }
  const entries = async () =>
    (
      await admin.query(
        `select 1 from audit_log where action = 'user.data_exported' and actor_id = $1`,
        [colleague],
      )
    ).rowCount
  const before = await entries()
  await Promise.all([buildDataExport(jobDeps(), job), buildDataExport(jobDeps(), job)])
  expect(await entries()).toBe((before ?? 0) + 1)
})

test('an account locked after the request gets no archive', async () => {
  const dto = await request(stranger)
  await admin.query('update users set security_locked_at = now() where id = $1', [stranger])
  try {
    await buildDataExport(jobDeps(), { userId: stranger, exportId: dto.id, ip: IP })
    expect((await listDataExports({ uow, clock }, { id: stranger }))[0]?.status).toBe('failed')
    expect(await storage.list(`users/${stranger}/exports/`)).toEqual([])
  } finally {
    await admin.query('update users set security_locked_at = null where id = $1', [stranger])
  }
})

test('past the activity cap only the newest entries go in, and the readme says so', async () => {
  const dto = await request(user)
  await buildDataExport(
    { ...jobDeps(), limits: { maxActivity: 2, auditPage: 1 } },
    { userId: user, exportId: dto.id, ip: IP },
  )
  const { object } = await open(user, dto.id)
  const files = unzipSync(await bytesOf(object))
  const { rows } = await admin.query<{ at: string }>(
    `select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
       from audit_log where actor_id = $1
      order by created_at desc, id desc`,
    [user],
  )
  const activity = json(files, 'attivita.json') as { quando: string }[]
  // the entry of this very export is written after the archive
  const before = rows.map((r) => r.at).filter((at) => at <= (activity[0]?.quando ?? ''))
  expect(activity.map((a) => a.quando)).toEqual(before.slice(0, 2))
  expect(text(files, 'LEGGIMI.txt')).toContain('ci sono solo le 2 azioni più recenti')
})

test('agencies where the membership is disabled or the agency suspended are included', async () => {
  const { person, suspended } = await seed(tdb.runtimeUrl, async (s) => {
    const p = await s.user()
    const off = await s.organization({ status: 'suspended' })
    await s.member(orgA, p, 'member', 'disabled')
    await s.member(off, p, 'member')
    return { person: p, suspended: off }
  })
  const { files } = await exportFor(person)
  const agencies = json(files, 'agenzie.json') as {
    id: string
    statoAppartenenza: string
    statoAgenzia: string
  }[]
  expect(agencies.find((a) => a.id === orgA)).toMatchObject({
    statoAppartenenza: 'disattivata',
    statoAgenzia: 'attiva',
  })
  expect(agencies.find((a) => a.id === suspended)).toMatchObject({
    statoAppartenenza: 'attiva',
    statoAgenzia: 'sospesa',
  })
})

test('an archive finished after the account was deleted is thrown away', async () => {
  const leaving = await seed(tdb.runtimeUrl, (s) => s.user())
  await request(leaving)
  const job = sent.at(-1)
  if (!job) throw new Error('no job queued')
  const deleting: DataExportJobDeps = {
    ...jobDeps(),
    storage: {
      ...storage,
      async put(key, body, opts) {
        const written = await storage.put(key, body, opts)
        await admin.query(
          `update users set status = 'disabled', anonymized_at = now() where id = $1`,
          [leaving],
        )
        return written
      },
    },
  }
  await buildDataExport(deleting, job)
  expect(await storage.list(`users/${leaving}/`)).toEqual([])
  const { rows } = await admin.query<{ status: string }>(
    'select status from data_exports where user_id = $1',
    [leaving],
  )
  expect(rows).toEqual([{ status: 'failed' }])
})

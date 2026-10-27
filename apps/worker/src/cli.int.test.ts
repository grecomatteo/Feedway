import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestDatabase } from '@app/infrastructure/testing'
import type { TestDatabase } from '@app/infrastructure/testing'
import { runCli } from './cli.js'

let tdb: TestDatabase
let admin: pg.Client
let env: Record<string, string>

beforeAll(async () => {
  tdb = await startTestDatabase()
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  env = {
    DATABASE_URL: tdb.runtimeUrl,
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    PANEL_URL: 'https://pannello.example.ts.net',
    BOOTSTRAP_OWNER_EMAIL: 'titolare@esempio.it',
    LOG_LEVEL: 'error',
  }
})
afterAll(async () => {
  await admin.end()
  await tdb.stop()
})

function capture() {
  const out: string[] = []
  const err: string[] = []
  return {
    io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) },
    out,
    err,
  }
}

test('cli bootstrap-link prints the link once', async () => {
  const c = capture()
  expect(await runCli(['bootstrap-link'], env, c.io)).toBe(0)
  expect(c.out).toHaveLength(1)
  expect(c.out[0]).toMatch(/^https:\/\/pannello\.example\.ts\.net\/attiva\/[A-Za-z0-9_-]+$/)
})

test('cli bootstrap-link refuses once the main account exists', async () => {
  await admin.query(
    "insert into users (id, name, email, platform_role) values (gen_random_uuid(), 'A', 'a@esempio.it', 'admin')",
  )
  const c = capture()
  expect(await runCli(['bootstrap-link'], env, c.io)).toBe(1)
  expect(c.err.join('\n')).toContain('Account principale già creato')
  expect(c.out).toEqual([])
})

test('cli bootstrap-link without the owner email explains what is missing', async () => {
  const c = capture()
  const withoutOwner = { ...env, BOOTSTRAP_OWNER_EMAIL: undefined }
  expect(await runCli(['bootstrap-link'], withoutOwner, c.io)).toBe(1)
  expect(c.err.join('\n')).toContain('BOOTSTRAP_OWNER_EMAIL')
})

test('cli rejects an unknown command and a broken configuration', async () => {
  const c = capture()
  expect(await runCli(['boh'], env, c.io)).toBe(64)
  expect(c.err.join('\n')).toContain('bootstrap-link')
  expect(c.err.join('\n')).toContain('create-organization')
  expect(await runCli(['bootstrap-link'], { ...env, APP_ENCRYPTION_KEY: 'corta' }, c.io)).toBe(78)
})

test('cli reports an unexpected failure with its own exit code and no link', async () => {
  const c = capture()
  const unreachable = { ...env, DATABASE_URL: 'postgres://nessuno:nessuna@127.0.0.1:1/app' }
  expect(await runCli(['bootstrap-link'], unreachable, c.io)).toBe(70)
  expect(c.out).toEqual([])
  expect(c.err.join('\n')).toMatch(/non riuscit/i)
})

async function lastAuditAsSystem() {
  const { rows } = await admin.query<{
    action: string
    source: string
    organization_id: string | null
    actor_id: string | null
  }>(
    `select action, source, organization_id, actor_id from audit_log
      order by created_at desc, id desc limit 1`,
  )
  const row = rows[0]
  return (
    row && {
      action: row.action,
      source: row.source,
      organizationId: row.organization_id,
      actorId: row.actor_id,
    }
  )
}

async function runCliCaptured(args: string[]) {
  const c = capture()
  const exitCode = await runCli(args, env, c.io)
  return { exitCode, stdout: c.out.join('\n'), stderr: c.err.join('\n') }
}

async function organization(slug: string) {
  const { rows } = await admin.query<{
    id: string
    status: string
    limits: Record<string, unknown>
  }>('select id, status, limits from organizations where slug = $1', [slug])
  return rows[0]
}

test('cli create-organization prints slug and link and audits as system', async () => {
  const out = await runCliCaptured([
    'create-organization',
    '--name',
    'Agenzia Verdi',
    '--owner-email',
    'v@verdi.it',
  ])
  expect(out.exitCode).toBe(0)
  expect(out.stdout).toMatch(/agenzia-verdi/)
  expect(out.stdout).toMatch(/\/attiva\//)
  expect(out.stdout.split('\n')).toHaveLength(2)
  expect(await lastAuditAsSystem()).toMatchObject({
    action: 'organization.created',
    source: 'system',
    organizationId: null,
    actorId: null,
  })
  const keys = await admin.query(
    "select 1 from organization_keys k join organizations o on o.id = k.organization_id where o.slug = 'agenzia-verdi'",
  )
  expect(keys.rowCount).toBe(1)
})

test('cli create-organization with an existing owner prints only the slug', async () => {
  await admin.query(
    "insert into users (id, name, email) values (gen_random_uuid(), 'Rosa', 'rosa@esempio.it')",
  )
  const out = await runCliCaptured([
    'create-organization',
    '--name',
    'Agenzia Rosa',
    '--owner-email',
    'rosa@esempio.it',
  ])
  expect(out.exitCode).toBe(0)
  expect(out.stdout).toBe('agenzia-rosa')
  expect(out.stderr).toMatch(/selettore/)
})

test('cli create-organization needs a name and an owner email', async () => {
  expect((await runCliCaptured(['create-organization', '--name', 'Senza Owner'])).exitCode).toBe(64)
  expect((await runCliCaptured(['create-organization', '--owner-email', 'a@b.it'])).exitCode).toBe(
    64,
  )
  expect((await runCliCaptured(['create-organization', '--nome', 'X'])).exitCode).toBe(64)
  const invalid = await runCliCaptured([
    'create-organization',
    '--name',
    'Agenzia Errata',
    '--owner-email',
    'non-email',
  ])
  expect(invalid.exitCode).toBe(1)
  expect(invalid.stderr).toMatch(/email/i)
})

test('cli suspends and reactivates an organization by slug', async () => {
  await runCliCaptured([
    'create-organization',
    '--name',
    'Agenzia Sospesa',
    '--owner-email',
    's@sospesa.it',
  ])
  const suspended = await runCliCaptured(['suspend-organization', 'agenzia-sospesa'])
  expect(suspended.exitCode).toBe(0)
  expect((await organization('agenzia-sospesa'))?.status).toBe('suspended')
  expect(await lastAuditAsSystem()).toMatchObject({
    action: 'organization.suspended',
    source: 'system',
  })
  expect((await runCliCaptured(['reactivate-organization', 'agenzia-sospesa'])).exitCode).toBe(0)
  expect((await organization('agenzia-sospesa'))?.status).toBe('active')
  const missing = await runCliCaptured(['suspend-organization', 'non-esiste'])
  expect(missing.exitCode).toBe(1)
  expect(missing.stderr).toMatch(/non trovata/i)
  expect((await runCliCaptured(['suspend-organization'])).exitCode).toBe(64)
})

test('cli set-limits replaces the limits; an option left out is unlimited', async () => {
  await runCliCaptured([
    'create-organization',
    '--name',
    'Agenzia Limiti',
    '--owner-email',
    'l@limiti.it',
  ])
  const set = await runCliCaptured([
    'set-limits',
    'agenzia-limiti',
    '--workspaces',
    '3',
    '--users',
    '10',
    '--storage-gb',
    '2',
  ])
  expect(set.exitCode).toBe(0)
  expect((await organization('agenzia-limiti'))?.limits).toEqual({
    workspaces: 3,
    users: 10,
    storage_bytes: 2 * 1024 ** 3,
  })
  expect(await lastAuditAsSystem()).toMatchObject({
    action: 'organization.limits_changed',
    source: 'system',
  })
  expect(
    (await runCliCaptured(['set-limits', 'agenzia-limiti', '--posts-per-day', '5'])).exitCode,
  ).toBe(0)
  expect((await organization('agenzia-limiti'))?.limits).toEqual({ posts_per_day: 5 })
  for (const bad of ['-1', '1.5', 'tre', ''])
    expect((await runCliCaptured(['set-limits', 'agenzia-limiti', '--users', bad])).exitCode).toBe(
      64,
    )
  expect((await organization('agenzia-limiti'))?.limits).toEqual({ posts_per_day: 5 })
})

test('cli list-organizations shows status, usage and limits', async () => {
  await runCliCaptured([
    'create-organization',
    '--name',
    'Agenzia Elenco',
    '--owner-email',
    'e@elenco.it',
  ])
  await runCliCaptured(['set-limits', 'agenzia-elenco', '--users', '4'])
  const out = await runCliCaptured(['list-organizations'])
  expect(out.exitCode).toBe(0)
  const line = out.stdout.split('\n').find((l) => l.startsWith('agenzia-elenco'))
  expect(line).toMatch(/attiva/)
  // the open Owner invite holds a seat, as the limit counts it
  expect(line).toMatch(/utenti 1\/4/)
  expect(line).toMatch(/spazi 0\/illimitati/)
})

test('cli disable-user and enable-user act on every organization', async () => {
  await admin.query(
    "insert into users (id, name, email) values (gen_random_uuid(), 'Gino', 'gino@esempio.it')",
  )
  const disabled = await runCliCaptured(['disable-user', 'GINO@esempio.it'])
  expect(disabled.exitCode).toBe(0)
  const status = async () =>
    (
      await admin.query<{ status: string }>(
        "select status from users where email = 'gino@esempio.it'",
      )
    ).rows[0]?.status
  expect(await status()).toBe('disabled')
  expect(await lastAuditAsSystem()).toMatchObject({
    action: 'user.disabled',
    source: 'system',
    organizationId: null,
  })
  expect((await runCliCaptured(['enable-user', 'gino@esempio.it'])).exitCode).toBe(0)
  expect(await status()).toBe('active')
  const missing = await runCliCaptured(['disable-user', 'nessuno@esempio.it'])
  expect(missing.exitCode).toBe(1)
  expect((await runCliCaptured(['enable-user'])).exitCode).toBe(64)
})

test('a database failure never puts the email, token hash or key material on stderr', async () => {
  for (const table of ['invites', 'organization_keys']) {
    await admin.query(
      `create function cli_test_fail() returns trigger language plpgsql as $$ begin raise exception 'guasto'; end $$`,
    )
    await admin.query(
      `create trigger cli_test_fail before insert on ${table} for each row execute function cli_test_fail()`,
    )
    try {
      const out = await runCliCaptured([
        'create-organization',
        '--name',
        `Agenzia Guasta ${table}`,
        '--owner-email',
        'segreta@guasto.it',
      ])
      expect(out.exitCode).toBe(70)
      expect(out.stdout).toBe('')
      expect(out.stderr).toMatch(/non riuscit/i)
      expect(out.stderr).not.toMatch(/segreta@guasto\.it|insert|params|\\x|v1\./i)
    } finally {
      await admin.query(`drop trigger cli_test_fail on ${table}`)
      await admin.query('drop function cli_test_fail()')
    }
  }
})

test('cli enable-user says when nothing changed, and keeps the password without a lock', async () => {
  await admin.query(
    "insert into users (id, name, email) values (gen_random_uuid(), 'Lia', 'lia@esempio.it')",
  )
  expect((await runCliCaptured(['enable-user', 'lia@esempio.it'])).stdout).toMatch(/già attivo/)
  const disabled = await runCliCaptured(['disable-user', 'lia@esempio.it'])
  expect(disabled.stdout).toMatch(/disattivato su tutte le agenzie/)
  const again = await runCliCaptured(['disable-user', 'lia@esempio.it'])
  expect(again.exitCode).toBe(0)
  expect(again.stdout).toMatch(/già disattivato/)
  const enabled = await runCliCaptured(['enable-user', 'lia@esempio.it'])
  // disabled by the platform, not locked by the person: no link, the password stays
  expect(enabled.stdout.split('\n')).toHaveLength(1)
  expect(enabled.stdout).toMatch(/riattivato/)
  expect(enabled.stderr).toBe('')

  await admin.query(
    "update users set status = 'disabled', anonymized_at = now() where email = 'lia@esempio.it'",
  )
  const anonymized = await runCliCaptured(['disable-user', 'lia@esempio.it'])
  expect(anonymized.stdout).toMatch(/anonimizzato/)
})

test('cli set-limits needs an option, and --unlimited clears every limit', async () => {
  await runCliCaptured([
    'create-organization',
    '--name',
    'Agenzia Libera',
    '--owner-email',
    'x@libera.it',
  ])
  const none = await runCliCaptured(['set-limits', 'agenzia-libera'])
  expect(none.exitCode).toBe(64)
  expect(none.stderr).toMatch(/--unlimited/)
  await runCliCaptured(['set-limits', ' Agenzia-Libera ', '--users', '2'])
  expect((await organization('agenzia-libera'))?.limits).toEqual({ users: 2 })
  expect(
    (await runCliCaptured(['set-limits', 'agenzia-libera', '--unlimited', '--users', '2']))
      .exitCode,
  ).toBe(64)
  expect((await runCliCaptured(['set-limits', 'agenzia-libera', '--unlimited'])).exitCode).toBe(0)
  expect((await organization('agenzia-libera'))?.limits).toEqual({})
})

async function lockedUser(name: string) {
  const email = `${name.toLowerCase()}@esempio.it`
  const { rows } = await admin.query<{ id: string }>(
    `insert into users (id, name, email, status, disabled_at, security_locked_at)
     values (gen_random_uuid(), $1, $2, 'disabled', now(), now()) returning id`,
    [name, email],
  )
  const id = rows[0]?.id ?? ''
  await admin.query(
    `insert into accounts (id, account_id, provider_id, user_id, password, updated_at)
     values (gen_random_uuid(), $1::text, 'credential', $1::uuid, 'hash-finto', now())`,
    [id],
  )
  return { id, email }
}

test('cli enable-user after "Non sono stato io" needs --verified-by, without free text', async () => {
  const { id, email } = await lockedUser('Ada')
  const missing = await runCliCaptured(['enable-user', email])
  expect(missing.exitCode).toBe(1)
  expect(missing.stderr).toMatch(/verificato l’identità/)
  expect(missing.stderr).toMatch(/--verified-by telefono\|di-persona\|videochiamata/)
  expect(missing.stdout).toBe('')
  const free = await runCliCaptured(['enable-user', email, '--verified-by', 'mi ha scritto'])
  expect(free.exitCode).toBe(64)
  const { rows } = await admin.query<{ status: string }>('select status from users where id = $1', [
    id,
  ])
  expect(rows[0]?.status).toBe('disabled')
})

test('cli enable-user after "Non sono stato io" sends the link to the account, not to stdout', async () => {
  const { id, email } = await lockedUser('Teo')
  const c = capture()
  const exitCode = await runCli(
    ['enable-user', email, '--verified-by', 'telefono'],
    { ...env, NODE_ENV: 'test' },
    c.io,
  )
  expect(exitCode).toBe(0)
  expect(c.out).toEqual([
    'Account riattivato: i link "Non sono stato io" precedenti non valgono più',
    "Link per la nuova password inviato all'indirizzo dell'account, valido 30 minuti",
  ])
  expect(c.err.join('\n')).toMatch(/rilancia il comando dopo aver verificato di nuovo l'identità/)
  expect(c.err.join('\n')).not.toMatch(/codice/i)
  expect([...c.out, ...c.err].join('\n')).not.toMatch(/platform\.|reset-password|hash-finto/)
  const accounts = await admin.query(
    "select 1 from accounts where user_id = $1 and provider_id = 'credential'",
    [id],
  )
  expect(accounts.rowCount).toBe(0)
  const jobs = await admin.query<{ data: { userId: string; url: string } }>(
    "select data from pgboss.job where name = 'identity.account_recovery_email'",
  )
  expect(jobs.rows.filter((j) => j.data.userId === id)).toHaveLength(1)
  const { rows: verified } = await admin.query<{ data: unknown }>(
    "select data from audit_log where action = 'user.identity_verified' and entity_id = $1",
    [id],
  )
  expect(verified.map((r) => r.data)).toEqual([{ method: 'phone_known_number' }])
})

test('cli enable-user without email prints the 30-minute link with a warning', async () => {
  const { id, email } = await lockedUser('Rita')
  const out = await runCliCaptured(['enable-user', email, '--verified-by', 'videochiamata'])
  expect(out.exitCode).toBe(0)
  const [status, link, ...rest] = out.stdout.split('\n')
  expect(status).toMatch(/riattivato/)
  expect(link).toMatch(
    /^https:\/\/pannello\.example\.ts\.net\/api\/auth\/reset-password\/platform\.[A-Za-z0-9_-]+\?callbackURL=%2Freimposta$/,
  )
  expect(rest).toEqual([])
  expect(out.stderr).toMatch(
    /vecchia password, le passkey e la verifica in due passaggi non valgono più/,
  )
  expect(out.stderr).toMatch(
    /consegnalo solo sul canale con cui hai verificato l'identità, vale 30 minuti/,
  )
  // the token appears only in the link, never on stderr
  expect(out.stderr).not.toMatch(/platform\.|hash-finto/)
  const token = new URL(link ?? '').pathname.split('/').at(-1) ?? ''
  const verification = await admin.query<{ value: string; expires_at: Date }>(
    'select value, expires_at from verifications where identifier = $1',
    [`reset-password:${token}`],
  )
  expect(verification.rows[0]?.value).toBe(id)
  const ttl = (verification.rows[0]?.expires_at.getTime() ?? 0) - Date.now()
  expect(ttl).toBeGreaterThan(29 * 60_000)
  expect(ttl).toBeLessThanOrEqual(30 * 60_000)
  const { rows: sent } = await admin.query<{ data: unknown }>(
    "select data from audit_log where action = 'auth.recovery_link_sent' and entity_id = $1",
    [id],
  )
  expect(sent.map((r) => r.data)).toEqual([{ channel: 'operator' }])
})

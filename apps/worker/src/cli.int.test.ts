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
  expect(await runCli(['bootstrap-link'], { ...env, APP_ENCRYPTION_KEY: 'corta' }, c.io)).toBe(78)
})

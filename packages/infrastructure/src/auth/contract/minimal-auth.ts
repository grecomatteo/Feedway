import { randomBytes } from 'node:crypto'
import { betterAuth } from 'better-auth'
import type { BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { twoFactor } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { drizzle } from 'drizzle-orm/node-postgres'
import { pushSchema } from 'drizzle-kit/api'
import pg from 'pg'
import { uuidV7Generator } from '../../system/id-generator.js'
import * as schema from '../../db/identity/schema.js'

export const CONTRACT_SECRET = 'contract-secret-'.padEnd(48, 'k')
export const CONTRACT_ORIGIN = 'https://app.feedway.test'

export interface ContractDatabase {
  pool: pg.Pool
  stop(): Promise<void>
}

/** A scratch database in the given Postgres, with the real identity schema applied. */
export async function createContractDatabase(adminUrl: string): Promise<ContractDatabase> {
  const name = `contract_${randomBytes(6).toString('hex')}`
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  await admin.query(`create database ${name}`)
  await admin.end()
  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  const pool = new pg.Pool({ connectionString: url.toString() })
  // Migration 0000 creates citext in production; pushSchema does not.
  await pool.query('create extension if not exists citext')
  const { apply } = await pushSchema(schema, drizzle(pool) as never)
  await apply()
  return {
    pool,
    async stop() {
      await pool.end()
    },
  }
}

export function authOptions(overrides: Partial<BetterAuthOptions> = {}): BetterAuthOptions {
  return {
    baseURL: CONTRACT_ORIGIN,
    secret: CONTRACT_SECRET,
    trustedOrigins: [CONTRACT_ORIGIN],
    ...overrides,
  }
}

export interface MinimalAuth {
  auth: ReturnType<typeof buildAuth>
  httpPost(path: string, body: unknown, cookie?: string): Promise<Response>
  rawRow(table: string, where: Record<string, string>): Promise<Record<string, any>>
  countRows(table: string, where: Record<string, string>): Promise<number>
}

export interface Site {
  origin: string
  rpID: string
}
const DEFAULT_SITE: Site = { origin: CONTRACT_ORIGIN, rpID: 'app.feedway.test' }

export function buildAuth(
  pool: pg.Pool,
  overrides: Partial<BetterAuthOptions>,
  site = DEFAULT_SITE,
) {
  const db = drizzle(pool, { schema })
  return betterAuth({
    ...authOptions({ baseURL: site.origin, trustedOrigins: [site.origin] }),
    database: drizzleAdapter(db, { provider: 'pg', usePlural: true, schema }),
    emailAndPassword: { enabled: true, disableSignUp: true, autoSignIn: false },
    session: {
      additionalFields: { authMethod: { type: 'string', defaultValue: 'password', input: false } },
    },
    plugins: [twoFactor(), passkey({ rpID: site.rpID, rpName: 'Feedway', origin: site.origin })],
    ...overrides,
    // Merged, not replaced: ids must stay UUID v7 whatever cookie options a test passes.
    advanced: {
      ...overrides.advanced,
      database: { generateId: () => uuidV7Generator.newId(), ...overrides.advanced?.database },
    },
  })
}

/** Better Auth with the minimal production-like configuration, on the scratch database. */
export function minimalAuth(
  pool: pg.Pool,
  overrides: Partial<BetterAuthOptions> = {},
): MinimalAuth {
  const auth = buildAuth(pool, overrides)
  return {
    auth,
    httpPost: (path, body, cookie) =>
      auth.handler(
        new Request(`${CONTRACT_ORIGIN}/api/auth${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: CONTRACT_ORIGIN,
            ...(cookie ? { cookie } : {}),
          },
          body: JSON.stringify(body),
        }),
      ),
    async rawRow(table, where) {
      const keys = Object.keys(where)
      const sql = `select * from ${table} where ${keys.map((k, i) => `${k} = $${String(i + 1)}`).join(' and ')} order by 1 desc limit 1`
      const { rows } = await pool.query(sql, Object.values(where))
      return rows[0] as Record<string, any>
    },
    async countRows(table, where) {
      const keys = Object.keys(where)
      const sql = `select count(*)::int as n from ${table} where ${keys.map((k, i) => `${k} = $${String(i + 1)}`).join(' and ')}`
      const { rows } = await pool.query(sql, Object.values(where))
      return rows[0].n as number
    },
  }
}

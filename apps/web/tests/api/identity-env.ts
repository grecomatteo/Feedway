import { randomBytes, randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import { createDb, createPasswordHasher } from '@app/infrastructure'
import type { DbHandle } from '@app/infrastructure'
import { seed, startTestDatabase } from '@app/infrastructure/testing'
import type { TestDatabase } from '@app/infrastructure/testing'
import { panelClient, sessionCookieOf, startWeb } from './helpers.js'
import type { CallOptions, RunningWeb } from './helpers.js'

export const PANEL = 'https://pannello.example.ts.net'
// low entropy on purpose: a made-up value, not a secret for the leak scanner
export const PASSWORD = 'cavallo-batteria-graffetta-lago'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface Person {
  userId: string
  email: string
}

/** A database, the production server and the helpers the identity route tests share. */
export interface ApiEnv {
  tdb: TestDatabase
  admin: DbHandle
  web: RunningWeb
  /** Every request from its own address, so the per-address limits stay out of the way. */
  call(method: Method, path: string, body?: unknown, opts?: CallOptions): Promise<Response>
  /** A new agency; its slug is its id. */
  agency(opts?: { status?: 'suspended' }): Promise<{ id: string; slug: string }>
  /** A person with a password, member of `organizationId` with `role`. */
  person(
    organizationId: string,
    role: 'owner' | 'admin' | 'member',
    opts?: { name?: string },
  ): Promise<Person>
  /** A password sign-in: for an Owner or Admin the session still owes the second factor. */
  signIn(person: Person): Promise<string>
  /** A session that satisfies the second factor, as a passkey sign-in leaves it. */
  strongSignIn(person: Person): Promise<string>
  /** A passkey row, so the person counts as having a second factor. */
  addPasskey(userId: string): Promise<void>
  reauth(cookie: string): Promise<void>
  stop(): Promise<void>
}

export async function startApiEnv(name: string): Promise<ApiEnv> {
  const tdb = await startTestDatabase()
  const admin = createDb(tdb.adminUrl, { max: 2, applicationName: `${name}-web-test` })
  const web = await startWeb({
    DATABASE_URL: tdb.runtimeUrl,
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    PANEL_URL: PANEL,
  })
  const panel = panelClient(web, PANEL)
  const hasher = createPasswordHasher()
  let host = 0

  const call: ApiEnv['call'] = (method, path, body, opts) => {
    host += 1
    return panel(method, path, body, {
      ...opts,
      headers: {
        'x-forwarded-for': `10.20.${String(Math.floor(host / 250))}.${String(host % 250)}`,
        ...opts?.headers,
      },
    })
  }

  const env: ApiEnv = {
    tdb,
    admin,
    web,
    call,
    async agency(opts = {}) {
      const id = await seed(tdb.runtimeUrl, (s) => s.organization(opts))
      return { id, slug: id }
    },
    async person(organizationId, role, opts = {}) {
      const email = `${name}-${randomUUID().slice(0, 8)}@example.test`
      const userId = await seed(tdb.runtimeUrl, async (s) => {
        const id = await s.user({ email, ...(opts.name === undefined ? {} : { name: opts.name }) })
        await s.member(organizationId, id, role)
        return id
      })
      await admin.pool.query(
        `insert into accounts (id, account_id, provider_id, user_id, password, updated_at)
         values ($1, $2::text, 'credential', $2::uuid, $3, now())`,
        [randomUUID(), userId, await hasher.hash(PASSWORD)],
      )
      return { userId, email }
    },
    async signIn(person) {
      const r = await call('POST', '/api/auth/sign-in/email', {
        email: person.email,
        password: PASSWORD,
      })
      expect(r.status).toBe(200)
      const cookie = sessionCookieOf(r)
      expect(cookie).toBeDefined()
      return cookie ?? ''
    },
    async strongSignIn(person) {
      const cookie = await env.signIn(person)
      // the passkey sign-in itself is covered by the Better Auth tests (Task 14)
      await admin.pool.query("update sessions set auth_method = 'passkey' where user_id = $1", [
        person.userId,
      ])
      return cookie
    },
    async addPasskey(userId) {
      await admin.pool.query(
        `insert into passkeys (id, name, public_key, user_id, credential_id, counter, device_type, backed_up, created_at)
         values ($1, 'Portatile', 'chiave-finta', $2, $3, 0, 'multiDevice', true, now())`,
        [randomUUID(), userId, randomBytes(16).toString('base64url')],
      )
    },
    async reauth(cookie) {
      const r = await call('POST', '/api/v1/auth/reauth', { password: PASSWORD }, { cookie })
      expect(r.status).toBe(200)
    },
    async stop() {
      await web.stop()
      await admin.close()
      await tdb.stop()
    },
  }
  return env
}

export interface ErrorJson {
  error: { code: string; message: string; requestId: string; reason?: string }
}
export const errorCodeOf = async (r: Response) => ((await r.json()) as ErrorJson).error.code

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { uuidV7Generator } from '../../system/id-generator.js'
import { buildAuth, createContractDatabase } from './minimal-auth.js'

export const CONTRACT_PASSWORD = 'una-password-molto-lunga-1'

const PAGE = `<!doctype html><meta charset="utf-8"><title>contract</title><body>ok</body>`

export interface ContractServer {
  origin: string
  email: string
  stop(): Promise<void>
}

/**
 * A bare HTTP server around Better Auth, on `app.feedway.localhost:<port>`, with one seeded user.
 * Only for the passkey contract test: the page is empty, the test drives the WebAuthn calls itself.
 */
export async function startContractServer(options: {
  adminUrl: string
  port: number
}): Promise<ContractServer> {
  const origin = `http://app.feedway.localhost:${String(options.port)}`
  const db = await createContractDatabase(options.adminUrl)
  const auth = buildAuth(
    db.pool,
    { advanced: { useSecureCookies: false, defaultCookieAttributes: { secure: true } } },
    { origin, rpID: 'app.feedway.localhost' },
  )
  const ctx = await auth.$context
  const id = uuidV7Generator.newId()
  const email = 'passkey@example.test'
  await ctx.internalAdapter.createUser(
    { id, email, name: 'Utente', emailVerified: true },
    { method: 'admin' },
  )
  await ctx.internalAdapter.linkAccount({
    userId: id,
    providerId: 'credential',
    accountId: id,
    password: await ctx.password.hash(CONTRACT_PASSWORD),
  })

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', origin)
      if (!url.pathname.startsWith('/api/auth/')) {
        res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE)
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
      const response = await auth.handler(
        new Request(url, {
          method: req.method ?? 'GET',
          headers,
          ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
        }),
      )
      const out: Record<string, string | string[]> = Object.fromEntries(
        [...response.headers].filter(([k]) => k !== 'set-cookie'),
      )
      out['set-cookie'] = response.headers.getSetCookie()
      res.writeHead(response.status, out).end(Buffer.from(await response.arrayBuffer()))
    })()
  })
  await new Promise<void>((resolve) =>
    server.listen(options.port, '127.0.0.1', () => {
      resolve()
    }),
  )
  return {
    origin,
    email,
    async stop() {
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve()
        }),
      )
      await db.stop()
    },
  }
}

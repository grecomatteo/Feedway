import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const webDir = fileURLToPath(new URL('../../', import.meta.url))

export const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition')
    await sleep(200)
  }
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => {
        resolve(port)
      })
    })
  })
}

export interface RunningWeb {
  url(path: string): string
  /** Everything the server wrote so far (its log lines), also echoed to this process. */
  output(): string
  stop(): Promise<void>
}

/** Builds the production server unless a build is already there. */
export function buildWebOnce(): void {
  if (!existsSync(`${webDir}.output/server/index.mjs`)) {
    execFileSync('pnpm', ['exec', 'nuxt', 'build'], { cwd: webDir, stdio: 'inherit' })
  }
}

/** Builds the app once and starts the production server against the given database. */
export async function startWeb(
  env: Record<string, string>,
  opts: { port?: number } = {},
): Promise<RunningWeb> {
  buildWebOnce()
  const port = opts.port ?? (await freePort())
  const child: ChildProcess = spawn('node', [`${webDir}.output/server/index.mjs`], {
    cwd: webDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      APP_TEST_ROUTES: '1',
      PORT: String(port),
      HOST: '127.0.0.1',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
    process.stdout.write(chunk)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
    process.stderr.write(chunk)
  })
  const base = `http://127.0.0.1:${String(port)}`
  await waitFor(
    () =>
      fetch(`${base}/api/health`).then(
        (r) => r.ok,
        () => false,
      ),
    60_000,
  )
  return {
    url: (path) => `${base}${path}`,
    output: () => output,
    stop() {
      return new Promise((resolve) => {
        child.once('exit', () => {
          resolve()
        })
        child.kill('SIGTERM')
      })
    },
  }
}

export interface CallOptions {
  cookie?: string | undefined
  origin?: string
  omitAppHeader?: boolean
  headers?: Record<string, string>
}

/** Requests as the panel sends them: its origin and the `X-App-Request` header, unless told otherwise. */
export function panelClient(web: RunningWeb, panel: string) {
  return function call(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    opts: CallOptions = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { origin: opts.origin ?? panel, ...opts.headers }
    if (!opts.omitAppHeader) headers['x-app-request'] = '1'
    if (body !== undefined) headers['content-type'] ??= 'application/json'
    if (opts.cookie !== undefined) headers['cookie'] = opts.cookie
    return fetch(web.url(path), {
      method,
      headers,
      body: body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body),
      redirect: 'manual',
    })
  }
}

/** `name=value` of the session cookie a response sets, if any. */
export const sessionCookieOf = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('__Host-session='))
    ?.split(';')[0]

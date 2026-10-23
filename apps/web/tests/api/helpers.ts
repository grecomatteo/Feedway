import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
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

function freePort(): Promise<number> {
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
  stop(): Promise<void>
}

const serverEntry = `${webDir}.output/server/index.mjs`
const buildLock = `${webDir}.test-build.lock`

/**
 * Builds the app once for all test files. Test files run in parallel processes: without the
 * lock two of them build at the same time and break each other's `.output`.
 */
async function ensureBuilt(): Promise<void> {
  const deadline = Date.now() + 10 * 60_000
  // a half-written .output can already hold the entry file: wait for the lock too
  while (!existsSync(serverEntry) || existsSync(buildLock)) {
    let owner = false
    try {
      mkdirSync(buildLock)
      owner = true
    } catch {
      // another test file is building: wait for it
    }
    if (owner) {
      try {
        if (!existsSync(serverEntry))
          execFileSync('pnpm', ['exec', 'nuxt', 'build'], { cwd: webDir, stdio: 'inherit' })
      } finally {
        rmSync(buildLock, { recursive: true, force: true })
      }
      return
    }
    if (Date.now() > deadline) throw new Error('timed out waiting for the web build')
    await sleep(500)
  }
}

/** Builds the app once and starts the production server against the given database. */
export async function startWeb(env: Record<string, string>): Promise<RunningWeb> {
  await ensureBuilt()
  const port = await freePort()
  const child: ChildProcess = spawn('node', [serverEntry], {
    cwd: webDir,
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), HOST: '127.0.0.1', ...env },
    stdio: 'inherit',
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

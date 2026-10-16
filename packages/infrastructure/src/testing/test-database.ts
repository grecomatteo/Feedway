import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { runMigrations } from '../db/migrate.js'
import { createLogger } from '../logging/logger.js'

export interface TestDatabase {
  runtimeUrl: string
  migratorUrl: string
  adminUrl: string
  /** Stops the container but keeps its data and port, so the URLs stay valid. */
  stopContainerOnly(): Promise<void>
  startContainerOnly(): Promise<void>
  stop(): Promise<void>
}

const POSTGRES_IMAGE = process.env['TEST_POSTGRES_IMAGE'] ?? 'postgres:18-alpine'
const MIGRATOR_PASSWORD = 'migrator-test-password'
const RUNTIME_PASSWORD = 'runtime-test-password'
const ADMIN_PASSWORD = 'admin-test-password'
const DB_NAME = 'app'

const dockerDir = fileURLToPath(new URL('../../../../docker/postgres/', import.meta.url))

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

async function waitUntilReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const client = new pg.Client({ connectionString: url })
    try {
      await client.connect()
      await client.query('select 1')
      return
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((r) => setTimeout(r, 300))
    } finally {
      await client.end().catch(() => undefined)
    }
  }
}

/**
 * Starts Postgres with the same roles.sql and init script as production, on a fixed host port
 * for the whole life of the test, then applies the migrations.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const port = await freePort()
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(DB_NAME)
    .withUsername('postgres')
    .withPassword(ADMIN_PASSWORD)
    .withExposedPorts({ container: 5432, host: port })
    .withCopyFilesToContainer([
      { source: `${dockerDir}roles.sql`, target: '/opt/feedway/roles.sql' },
      {
        source: `${dockerDir}init/01-roles.sh`,
        target: '/docker-entrypoint-initdb.d/01-roles.sh',
        mode: 0o755,
      },
    ])
    .withCopyContentToContainer([
      { content: MIGRATOR_PASSWORD, target: '/run/secrets/db_migrator_password' },
      { content: RUNTIME_PASSWORD, target: '/run/secrets/db_runtime_password' },
    ])
    .start()

  const url = (user: string, password: string) =>
    `postgres://${user}:${password}@127.0.0.1:${String(port)}/${DB_NAME}`
  const db: TestDatabase = {
    runtimeUrl: url('app_runtime', RUNTIME_PASSWORD),
    migratorUrl: url('app_migrator', MIGRATOR_PASSWORD),
    adminUrl: url('postgres', ADMIN_PASSWORD),
    stopContainerOnly() {
      execFileSync('docker', ['stop', '--time', '2', container.getId()])
      return Promise.resolve()
    },
    async startContainerOnly() {
      execFileSync('docker', ['start', container.getId()])
      await waitUntilReady(db.adminUrl, 60_000)
    },
    async stop() {
      await container.stop()
    },
  }

  await waitUntilReady(db.migratorUrl, 60_000)
  await runMigrations({
    migratorUrl: db.migratorUrl,
    runtimeRole: 'app_runtime',
    logger: createLogger({ service: 'migrate', level: 'error' }),
  })
  return db
}

import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { PgBoss } from 'pg-boss'
import type { Logger } from '@app/application'
import { QUEUE_DEFAULTS, QUEUES } from '../queue/queues.js'

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url))

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`

export interface RunMigrationsOptions {
  migratorUrl: string
  runtimeRole: string
  logger: Logger
}

/** Drizzle migrations, then the pg-boss schema and queues, then grants to the runtime role. Idempotent. */
export async function runMigrations(opts: RunMigrationsOptions): Promise<void> {
  const { migratorUrl, runtimeRole, logger } = opts

  const pool = new pg.Pool({ connectionString: migratorUrl, max: 1, application_name: 'migrate' })
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER })
    logger.info({}, 'database migrations applied')
  } finally {
    await pool.end()
  }

  const boss = new PgBoss({
    connectionString: migratorUrl,
    schema: 'pgboss',
    migrate: true,
    supervise: false,
    schedule: false,
    application_name: 'migrate',
    max: 2,
  })
  boss.on('error', (error) => {
    logger.error({ err: error }, 'pg-boss error during migration')
  })
  try {
    await boss.start()
    for (const { name, policy, retention } of QUEUES) {
      await boss.createQueue(name, { policy, ...QUEUE_DEFAULTS, ...retention })
    }
  } finally {
    await boss.stop({ graceful: false })
  }
  logger.info({}, 'queue schema ready')

  const role = quoteIdent(runtimeRole)
  const grants = new pg.Pool({ connectionString: migratorUrl, max: 1, application_name: 'migrate' })
  try {
    await grants.query(`GRANT USAGE ON SCHEMA pgboss TO ${role}`)
    await grants.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO ${role}`,
    )
    await grants.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO ${role}`)
    await grants.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO ${role}`)
    // tables pg-boss creates later (queue partitions) must stay reachable
    await grants.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    )
    // the audit log is append-only for the runtime role (migration 0002)
    await grants.query(`REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM ${role}`)
    await grants.query(
      `GRANT EXECUTE ON FUNCTION audit_shorten_ips(timestamptz), shares_active_organization(uuid, uuid), organization_count(uuid) TO ${role}`,
    )
  } finally {
    await grants.end()
  }
}

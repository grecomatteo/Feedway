import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import pg from 'pg'
import * as schema from './schema/index.js'

export type Db = NodePgDatabase<typeof schema>
/** The pool or an open transaction: repositories accept either. */
export type DbExecutor = PgDatabase<NodePgQueryResultHKT, typeof schema>

export interface DbHandle {
  db: Db
  pool: pg.Pool
  close(): Promise<void>
}

export function createDb(url: string, opts: { max: number; applicationName: string }): DbHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max: opts.max,
    connectionTimeoutMillis: 3000,
    application_name: opts.applicationName,
  })
  // an idle client dropped by the server (e.g. a restart) must not crash the process
  pool.on('error', () => undefined)
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() }
}

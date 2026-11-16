import type pg from 'pg'
import type { ExclusiveLock } from '@app/application'

// A lock for the whole installation (ADR 021): a Postgres advisory lock at session level, on a
// connection kept for as long as the work runs. Every process sharing the database sees it, so
// two workers never convert at once; if the connection drops, the lock goes with it.

const key = (name: string) => `feedway:${name}`

export function createAdvisoryLock(pool: pg.Pool): ExclusiveLock {
  return {
    async tryRun(name, fn) {
      const client = await pool.connect()
      let broken = false
      try {
        const res = await client.query<{ held: boolean }>(
          'select pg_try_advisory_lock(hashtextextended($1, 0)) as held',
          [key(name)],
        )
        if (res.rows[0]?.held !== true) return { acquired: false }
        try {
          return { acquired: true, value: await fn() }
        } finally {
          try {
            await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [key(name)])
          } catch {
            // the connection is gone, and the lock with it: never hand it back to the pool
            broken = true
          }
        }
      } finally {
        client.release(broken)
      }
    },
  }
}

import pg from 'pg'

/**
 * Resolves once a backend with this application_name is waiting on a row lock, so a
 * concurrency test proves the wait instead of relying on timing. For tests only.
 */
export async function waitForLockWaiter(
  url: string,
  applicationName: string,
  timeoutMs = 10_000,
): Promise<void> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity
          where application_name = $1 and wait_event_type = 'Lock'`,
        [applicationName],
      )
      if ((rows[0]?.n ?? 0) > 0) return
      if (Date.now() > deadline) throw new Error('no backend is waiting on a lock')
      await new Promise((r) => setTimeout(r, 20))
    }
  } finally {
    await client.end()
  }
}

import pg from 'pg'

export type Scope =
  | { kind: 'none' }
  | { kind: 'system' }
  | { kind: 'user'; userId: string }
  | { kind: 'organization'; organizationId: string; userId?: string }

/**
 * Runs `fn` in one transaction with the session variables that row level security reads,
 * set the way the unit of work will set them. For tests only: production code goes through
 * `uow.run` / `runAsSystem`.
 */
export async function withScope<T>(
  url: string,
  scope: Scope,
  fn: (c: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query('begin')
    if (scope.kind === 'system')
      await client.query(`select set_config('app.scope', 'system', true)`)
    if (scope.kind === 'organization') {
      await client.query(`select set_config('app.organization_id', $1, true)`, [
        scope.organizationId,
      ])
    }
    if ((scope.kind === 'user' || scope.kind === 'organization') && scope.userId) {
      await client.query(`select set_config('app.user_id', $1, true)`, [scope.userId])
    }
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    await client.end()
  }
}

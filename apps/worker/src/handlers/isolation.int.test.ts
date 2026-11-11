import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { QueueName, QueueScopes } from '@app/application'
import { QUEUES, type Runtime } from '@app/infrastructure'
import { startTestDatabase, type TestDatabase } from '@app/infrastructure/testing'
import { startMetaMock, type MetaMock } from '@app/meta-mock'
import type { JobHandler, JobHandlerDeps } from '../job-handler.js'
import { accountsHealth } from './accounts-health.js'
import { accountsSync } from './accounts-sync.js'
import {
  FORNO_LUCE,
  accountsRuntime,
  agency,
  connection,
  handlerDeps,
  recordingQueue,
  type Agency,
} from '../../tests/accounts-jobs.js'

// Isolation battery of the jobs (plan 03 Task 10): every queue of scope `organization` in the
// registry reads and writes only the agency named in its data, and fails without it. A queue
// added without a case here fails the first test.

type OrganizationQueue = {
  [N in QueueName]: QueueScopes[N] extends 'organization' ? N : never
}[QueueName]

interface World {
  a: Agency
  b: Agency
  /** The data of a job of A, and of A naming something of B. */
  ofA: Record<string, unknown>
  crossing: Record<string, unknown>
}

interface IsolationCase<N extends OrganizationQueue> {
  handler: JobHandler<N>
  /** Two agencies with what the job works on; the job of A must change something of A. */
  world(): Promise<World>
}

let tdb: TestDatabase
let mock: MetaMock
let runtime: Runtime
let admin: pg.Client

async function connectionsWorld(): Promise<World> {
  const a = await agency(tdb, runtime)
  const b = await agency(tdb, runtime)
  const ofA = await connection(runtime, a, { accounts: FORNO_LUCE })
  const ofB = await connection(runtime, b, { accounts: FORNO_LUCE })
  return {
    a,
    b,
    ofA: { organizationId: a.organizationId, connectionId: ofA.id },
    crossing: { organizationId: a.organizationId, connectionId: ofB.id },
  }
}

const CASES: { [N in OrganizationQueue]: IsolationCase<N> } = {
  'accounts.sync': { handler: accountsSync, world: connectionsWorld },
  'accounts.health': { handler: accountsHealth, world: connectionsWorld },
}

// every row an agency's job could touch, by agency
const SNAPSHOT_QUERIES = [
  'select * from account_connections where organization_id = $1 order by id',
  'select * from social_accounts where organization_id = $1 order by id',
  'select * from workspace_accounts where organization_id = $1 order by account_id',
  'select * from audit_log where organization_id = $1 order by id',
]

async function snapshot(of: Agency): Promise<unknown[]> {
  const out: unknown[] = []
  for (const q of SNAPSHOT_QUERIES) out.push((await admin.query(q, [of.organizationId])).rows)
  return out
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  mock = await startMetaMock()
  runtime = await accountsRuntime(tdb, mock)
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
}, 120_000)

afterAll(async () => {
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 })
  await runtime.close()
  await admin.end()
  await mock.stop()
  await tdb.stop()
})

const organizationQueues = QUEUES.filter((q) => q.scope === 'organization').map((q) => q.name)

test('every organization queue of the registry has its case', () => {
  expect(organizationQueues.length).toBeGreaterThan(0)
  expect([...organizationQueues].sort()).toEqual(Object.keys(CASES).sort())
})

/** Any data, as a producer with a bug could send it: the handler must judge it. */
type AnyDataHandler = (job: { id: string; data: unknown }, deps: JobHandlerDeps) => Promise<void>

const run = (name: OrganizationQueue, data: Record<string, unknown>) =>
  (CASES[name].handler as AnyDataHandler)(
    { id: 'lavoro', data },
    handlerDeps(runtime, recordingQueue()),
  )

test.each(organizationQueues as OrganizationQueue[])(
  '%s works on its own agency only',
  async (name) => {
    const world = await CASES[name].world()
    const beforeA = await snapshot(world.a)
    const beforeB = await snapshot(world.b)
    await run(name, world.ofA)
    // the job did its work in A (otherwise the case proves nothing), and nothing in B
    expect(await snapshot(world.a)).not.toEqual(beforeA)
    expect(await snapshot(world.b)).toEqual(beforeB)

    // A's agency naming B's things: B is not seen, so nothing happens anywhere
    const afterA = await snapshot(world.a)
    await run(name, world.crossing)
    expect(await snapshot(world.a)).toEqual(afterA)
    expect(await snapshot(world.b)).toEqual(beforeB)
  },
)

test.each(organizationQueues as OrganizationQueue[])(
  '%s fails without organizationId',
  async (name) => {
    const world = await CASES[name].world()
    const withoutAgency = { ...world.ofA }
    delete withoutAgency.organizationId
    const beforeA = await snapshot(world.a)
    await expect(run(name, withoutAgency)).rejects.toThrow(/organizationId/)
    await expect(run(name, { ...world.ofA, organizationId: '' })).rejects.toThrow(/organizationId/)
    expect(await snapshot(world.a)).toEqual(beforeA)
  },
)

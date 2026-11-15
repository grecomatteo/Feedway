import { randomBytes } from 'node:crypto'
import { GenericContainer, Wait } from 'testcontainers'
import type { StartedTestContainer } from 'testcontainers'

export interface TestGarage {
  /** By name, not IP: the S3 client then needs `forcePathStyle` (ADR 021). */
  endpoint: string
  bucket: string
  region: string
  credentials: { accessKeyId: string; secretAccessKey: string }
  stop(): Promise<void>
}

// Pinned by digest (ADR 021): no Renovate manager reads this file, so tag and digest change by hand.
const GARAGE_IMAGE =
  process.env['TEST_GARAGE_IMAGE'] ??
  'dxflrs/garage:v2.5.0@sha256:677e5b758e4425a325b811c425c026bf35a4bf42f7ddbaa773de3f4fd779a5a5'
const REGION = 'garage'
const BUCKET = 'feedway-test'

// One node, no replication; IPv4 binds because the CI runners have no IPv6 in containers.
const config = (rpcSecret: string) => `metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "0.0.0.0:3901"
rpc_secret = "${rpcSecret}"

[s3_api]
s3_region = "${REGION}"
api_bind_addr = "0.0.0.0:3900"
`

async function garage(container: StartedTestContainer, ...args: string[]): Promise<string> {
  const result = await container.exec(['/garage', ...args])
  if (result.exitCode !== 0)
    throw new Error(`garage ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  return result.stdout
}

/** Starts a one-node Garage with one bucket and a key that can read and write it. */
export async function startTestGarage(): Promise<TestGarage> {
  const container = await new GenericContainer(GARAGE_IMAGE)
    .withCopyContentToContainer([
      { content: config(randomBytes(32).toString('hex')), target: '/etc/garage.toml' },
    ])
    .withExposedPorts(3900)
    .withWaitStrategy(Wait.forLogMessage(/S3 API server listening/))
    .start()
  try {
    const nodeId = (await garage(container, 'node', 'id', '-q')).trim().slice(0, 16)
    await garage(container, 'layout', 'assign', '-z', 'dc1', '-c', '1G', nodeId)
    await garage(container, 'layout', 'apply', '--version', '1')
    await garage(container, 'bucket', 'create', BUCKET)
    const credentials = {
      accessKeyId: `GK${randomBytes(12).toString('hex')}`,
      secretAccessKey: randomBytes(32).toString('hex'),
    }
    await garage(
      container,
      'key',
      'import',
      '--yes',
      credentials.accessKeyId,
      credentials.secretAccessKey,
    )
    await garage(
      container,
      'bucket',
      'allow',
      '--read',
      '--write',
      '--owner',
      BUCKET,
      '--key',
      credentials.accessKeyId,
    )
    return {
      endpoint: `http://localhost:${String(container.getMappedPort(3900))}`,
      bucket: BUCKET,
      region: REGION,
      credentials,
      async stop() {
        await container.stop()
      },
    }
  } catch (error) {
    await container.stop()
    throw error
  }
}

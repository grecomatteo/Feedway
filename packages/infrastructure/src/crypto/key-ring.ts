import { hkdfSync, randomBytes } from 'node:crypto'
import type { Clock, KeyRing, KeyTx, OrganizationKeyRecord } from '@app/application'
import { createSecretBox } from './secret-box.js'

const PLATFORM_KEY_VERSION = 1
const DEFAULT_CACHE_TTL_MS = 10 * 60_000

export interface KeyRingOptions {
  /** APP_ENCRYPTION_KEY, 32 bytes */
  platformKey: Buffer
  clock: Clock
  /** How long a decrypted organization key stays in memory (at most 10 minutes). */
  cacheTtlMs?: number
}

const aadFor = (organizationId: string, version: number) =>
  `organization_keys:${organizationId}:${String(version)}`

/**
 * Envelope encryption: each organization has a random 32-byte data key per version, stored
 * sealed with the platform key. Secrets of the organization are sealed with its data key.
 */
export function createKeyRing(opts: KeyRingOptions): KeyRing {
  // Derived rather than used directly: APP_ENCRYPTION_KEY also feeds the signed-token keys.
  const platformKey = Buffer.from(
    hkdfSync('sha256', opts.platformKey, Buffer.alloc(0), 'feedway:platform-secret-box', 32),
  )
  const platform = createSecretBox(
    new Map([[PLATFORM_KEY_VERSION, platformKey]]),
    PLATFORM_KEY_VERSION,
  )
  const ttl = Math.min(opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS)
  const cache = new Map<string, { key: Buffer; expiresAt: number }>()

  function evictExpired(now: number) {
    for (const [id, entry] of cache) if (entry.expiresAt <= now) cache.delete(id)
  }

  // Each SecretBox gets its own copy of the key: an entry leaving the cache must never change a
  // box that is still in use. (Zeroing would be best effort anyway: the decoded key string stays
  // in the JS heap.)
  function dataKey(organizationId: string, record: OrganizationKeyRecord, now: number): Buffer {
    const id = `${organizationId}:${String(record.version)}`
    const cached = cache.get(id)
    if (cached && cached.expiresAt > now) return Buffer.from(cached.key)
    const key = Buffer.from(
      platform.open(record.keyEnc, aadFor(organizationId, record.version)),
      'base64',
    )
    cache.set(id, { key, expiresAt: now + ttl })
    // drops the entry after the TTL even if no other call comes (the process may stay idle)
    setTimeout(() => {
      if (cache.get(id)?.key === key) cache.delete(id)
    }, ttl).unref()
    return Buffer.from(key)
  }

  async function seal(tx: KeyTx, organizationId: string, version: number) {
    const key = randomBytes(32)
    await tx.organizationKeys.insert(
      organizationId,
      version,
      platform.seal(key.toString('base64'), aadFor(organizationId, version)),
    )
    key.fill(0)
  }

  return {
    platform: () => platform,

    async forOrganization(tx, organizationId) {
      const records = await tx.organizationKeys.list(organizationId)
      if (records.length === 0) throw new Error('organization has no data key')
      const now = opts.clock.now().getTime()
      evictExpired(now)
      const keys = new Map(records.map((r) => [r.version, dataKey(organizationId, r, now)]))
      const active = records.filter((r) => r.retiredAt === null).at(-1) ?? records.at(-1)
      return createSecretBox(keys, active?.version ?? 0)
    },

    async createOrganizationKey(tx, organizationId) {
      const records = await tx.organizationKeys.list(organizationId)
      if (records.length > 0) throw new Error('organization already has a data key')
      await seal(tx, organizationId, 1)
    },

    async rotateOrganizationKey(tx, organizationId) {
      const records = await tx.organizationKeys.list(organizationId)
      const latest = records.at(-1)
      if (!latest) throw new Error('organization has no data key')
      await seal(tx, organizationId, latest.version + 1)
      const at = opts.clock.now()
      for (const r of records) {
        if (r.retiredAt === null) await tx.organizationKeys.retire(organizationId, r.version, at)
      }
    },
  }
}

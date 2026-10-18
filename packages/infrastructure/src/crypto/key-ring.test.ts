import { randomBytes } from 'node:crypto'
import { expect, test } from 'vitest'
import type { KeyTx, OrganizationKeyRecord } from '@app/application'
import { fixedClock } from '../testing/index.js'
import { createKeyRing } from './key-ring.js'
import { createSecretBox } from './secret-box.js'

// In-memory repository: the database version is covered by key-ring.int.test.ts.
function memoryTx() {
  const rows = new Map<string, OrganizationKeyRecord[]>()
  const tx: KeyTx = {
    organizationKeys: {
      list: (org) =>
        Promise.resolve([...(rows.get(org) ?? [])].sort((a, b) => a.version - b.version)),
      insert(org, version, keyEnc) {
        rows.set(org, [...(rows.get(org) ?? []), { version, keyEnc, retiredAt: null }])
        return Promise.resolve()
      },
      retire(org, version, at) {
        const r = rows.get(org)?.find((x) => x.version === version)
        if (r) r.retiredAt = at
        return Promise.resolve()
      },
    },
  }
  return { tx, rows }
}

const clock = fixedClock(new Date('2026-10-18T10:00:00Z'))
const ring = createKeyRing({ platformKey: randomBytes(32), clock })

test('an organization key must be created before use, and only once', async () => {
  const { tx } = memoryTx()
  await expect(ring.forOrganization(tx, 'A')).rejects.toThrow(/no data key/)
  await ring.createOrganizationKey(tx, 'A')
  await expect(ring.createOrganizationKey(tx, 'A')).rejects.toThrow(/already/)
})

test('the stored key is sealed with the platform key', async () => {
  const { tx, rows } = memoryTx()
  await ring.createOrganizationKey(tx, 'A')
  expect(rows.get('A')?.[0]?.keyEnc).toMatch(/^v1\.1\./)
  const otherPlatform = createKeyRing({ platformKey: randomBytes(32), clock })
  await expect(otherPlatform.forOrganization(tx, 'A')).rejects.toThrow()
})

test('a stored key moved to another organization or version does not open', async () => {
  const { tx, rows } = memoryTx()
  await ring.createOrganizationKey(tx, 'A')
  const keyEnc = rows.get('A')?.[0]?.keyEnc ?? ''
  rows.set('B', [{ version: 1, keyEnc, retiredAt: null }])
  await expect(ring.forOrganization(tx, 'B')).rejects.toThrow()
  rows.set('C', [])
  await ring.createOrganizationKey(tx, 'C')
  rows.get('C')?.push({ version: 2, keyEnc: rows.get('C')?.[0]?.keyEnc ?? '', retiredAt: null })
  await expect(ring.forOrganization(tx, 'C')).rejects.toThrow()
})

test('a box keeps its real key after the cache entry expires (regression)', async () => {
  const { tx } = memoryTx()
  const ring2 = createKeyRing({ platformKey: randomBytes(32), clock })
  await ring2.createOrganizationKey(tx, 'A')
  const boxA = await ring2.forOrganization(tx, 'A')
  clock.advance(11 * 60_000)
  // a later call evicts the expired entry while boxA is still in use
  const fresh = await ring2.forOrganization(tx, 'A')
  const sealed = boxA.seal('secret', 'k')
  expect(fresh.open(sealed, 'k')).toBe('secret')
  const zeroKey = createSecretBox(new Map([[1, Buffer.alloc(32)]]), 1)
  expect(() => zeroKey.open(sealed, 'k')).toThrow()
})

test('rotation retires the old version, keeps old secrets readable and seals with the new one', async () => {
  const { tx, rows } = memoryTx()
  await ring.createOrganizationKey(tx, 'A')
  const before = (await ring.forOrganization(tx, 'A')).seal('x', 'k')
  await ring.rotateOrganizationKey(tx, 'A')
  const after = await ring.forOrganization(tx, 'A')
  expect(after.open(before, 'k')).toBe('x')
  expect(after.seal('y', 'k')).toMatch(/^v1\.2\./)
  expect(rows.get('A')?.map((r) => r.retiredAt !== null)).toEqual([true, false])
})

test('decrypted keys stay in memory for at most 10 minutes', async () => {
  const { tx, rows } = memoryTx()
  const ring2 = createKeyRing({ platformKey: randomBytes(32), clock, cacheTtlMs: 60 * 60_000 })
  await ring2.createOrganizationKey(tx, 'A')
  const sealed = (await ring2.forOrganization(tx, 'A')).seal('x', 'k')
  // corrupt the stored key: only a fresh decrypt notices
  const row = rows.get('A')?.[0]
  if (row) row.keyEnc = row.keyEnc.replace(/^v1\.1\./, 'v1.1.A')
  clock.advance(9 * 60_000)
  expect((await ring2.forOrganization(tx, 'A')).open(sealed, 'k')).toBe('x')
  clock.advance(2 * 60_000)
  await expect(ring2.forOrganization(tx, 'A')).rejects.toThrow()
})

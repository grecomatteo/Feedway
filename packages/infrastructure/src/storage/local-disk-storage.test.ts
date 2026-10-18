import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { createLocalDiskStorage } from './local-disk-storage.js'
import { storageContract } from './storage-contract.testkit.js'

storageContract('local disk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'feedway-storage-'))
  return {
    storage: createLocalDiskStorage({ root }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
})

test('leaves no temporary files after a successful put', async () => {
  const root = await mkdtemp(join(tmpdir(), 'feedway-storage-'))
  try {
    const s = createLocalDiskStorage({ root })
    const owner = '0197c5a0-0000-7000-8000-000000000001'
    await s.put(`users/${owner}/a.bin`, Buffer.from('x'), {
      contentType: 'application/octet-stream',
    })
    const names = await readdir(join(root, 'users', owner))
    expect(names.sort()).toEqual(['a.bin', 'a.bin.meta.json'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

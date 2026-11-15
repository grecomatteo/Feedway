import { ListMultipartUploadsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { DeleteObjectsCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createStorage } from '../runtime.js'
import { startTestGarage } from '../testing/test-garage.js'
import type { TestGarage } from '../testing/test-garage.js'
import { createS3Storage, S3_PART_SIZE } from './s3-storage.js'
import { storageContract } from './storage-contract.testkit.js'

let garage: TestGarage
let admin: S3Client

beforeAll(async () => {
  garage = await startTestGarage()
  admin = new S3Client({
    endpoint: garage.endpoint,
    region: garage.region,
    credentials: garage.credentials,
    forcePathStyle: true,
  })
})

afterAll(async () => {
  admin.destroy()
  await garage.stop()
})

const options = () => ({
  endpoint: garage.endpoint,
  bucket: garage.bucket,
  region: garage.region,
  credentials: garage.credentials,
  forcePathStyle: true,
})

/** Empties the bucket, objects and unfinished multipart uploads alike. */
async function emptyBucket(): Promise<void> {
  for (;;) {
    const page = await admin.send(new ListObjectsV2Command({ Bucket: garage.bucket }))
    const keys = (page.Contents ?? []).flatMap((o) => (o.Key === undefined ? [] : [{ Key: o.Key }]))
    if (keys.length === 0) break
    await admin.send(new DeleteObjectsCommand({ Bucket: garage.bucket, Delete: { Objects: keys } }))
  }
}

storageContract('S3 on Garage', async () => {
  await emptyBucket()
  return { storage: createS3Storage(options()), cleanup: emptyBucket }
})

const owner = '0197c5a0-0000-7000-8000-000000000001'

async function* chunks(total: number, failAfter?: number): AsyncGenerator<Uint8Array> {
  const chunk = Buffer.alloc(1024 * 1024, 7)
  for (let sent = 0; sent < total; sent += chunk.length) {
    if (failAfter !== undefined && sent >= failAfter) throw new Error('rete caduta')
    yield chunk
    await Promise.resolve()
  }
}

test('a streamed put above the part size goes multipart and reads back whole', async () => {
  await emptyBucket()
  const s = createS3Storage(options())
  const key = `org/${owner}/media/big.mp4`
  const total = S3_PART_SIZE + 3 * 1024 * 1024
  expect(await s.put(key, chunks(total), { contentType: 'video/mp4' })).toEqual({ size: total })
  const found = await s.getRange(key, S3_PART_SIZE - 2, S3_PART_SIZE + 1)
  expect(found).toMatchObject({
    size: total,
    range: { start: S3_PART_SIZE - 2, end: S3_PART_SIZE + 1 },
  })
  let read = 0
  for await (const chunk of found?.body ?? []) read += chunk.byteLength
  expect(read).toBe(4)
})

test('a multipart put that fails midway leaves no object and no parts', async () => {
  await emptyBucket()
  const s = createS3Storage(options())
  const key = `org/${owner}/media/broken.mp4`
  await expect(
    s.put(key, chunks(3 * S3_PART_SIZE, S3_PART_SIZE + 1024 * 1024), { contentType: 'video/mp4' }),
  ).rejects.toThrow('rete caduta')
  expect(await s.get(key)).toBeNull()
  expect(await s.list(`org/${owner}/`)).toEqual([])
  const uploads = await admin.send(new ListMultipartUploadsCommand({ Bucket: garage.bucket }))
  expect(uploads.Uploads ?? []).toEqual([])
})

test('objects the storage did not write under its keys are not listed', async () => {
  await emptyBucket()
  const s = createS3Storage(options())
  await s.put(`org/${owner}/a.bin`, Buffer.from('x'), { contentType: 'text/plain' })
  await admin.send(
    new PutObjectCommand({ Bucket: garage.bucket, Key: `org/${owner}/Strano.bin`, Body: 'y' }),
  )
  expect((await s.list(`org/${owner}/`)).map((o) => o.key)).toEqual([`org/${owner}/a.bin`])
})

test('createStorage picks the bucket with STORAGE_DRIVER=s3, the disk otherwise', async () => {
  await emptyBucket()
  const root = await mkdtemp(join(tmpdir(), 'feedway-storage-'))
  try {
    const key = `org/${owner}/logo/a.webp`
    const s3 = createStorage({ mediaRoot: root, storage: { driver: 's3', ...options() } })
    await s3.put(key, Buffer.from('x'), { contentType: 'image/webp' })
    const listed = await admin.send(new ListObjectsV2Command({ Bucket: garage.bucket }))
    expect(listed.Contents?.map((o) => o.Key)).toEqual([key])
    expect(await readdir(root)).toEqual([])

    const disk = createStorage({ mediaRoot: root, storage: { driver: 'disk' } })
    await disk.put(key, Buffer.from('y'), { contentType: 'image/webp' })
    expect(await readdir(join(root, 'org', owner, 'logo'))).toEqual(['a.webp'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

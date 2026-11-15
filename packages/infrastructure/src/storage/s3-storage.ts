import { Readable } from 'node:stream'
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'
import type { GetObjectCommandOutput, _Object } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type { Storage, StoredObject } from '@app/application'
import {
  byKey,
  checkContentType,
  checkKey,
  checkRange,
  invalid,
  KEY,
  LIST_PREFIX,
  PREFIX,
} from './storage-keys.js'

export interface S3StorageOptions {
  /** Unset for AWS itself; R2 and Garage need it. */
  endpoint: string | undefined
  bucket: string
  region: string
  credentials: { accessKeyId: string; secretAccessKey: string }
  forcePathStyle: boolean
  /** Bytes per multipart part, and the size above which `put` goes multipart. */
  partSize?: number
}

/** ADR 008 and 021: the same 20 MiB as the upload pieces. */
export const S3_PART_SIZE = 20 * 1024 * 1024
/** The most keys a single DeleteObjects or ListObjectsV2 call takes or returns. */
const PAGE = 1000

const statusOf = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null && '$metadata' in error
    ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
    : undefined

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/

/**
 * Objects in one S3 bucket (Garage in the tests, R2 later), with the same keys and behaviour
 * as the disk: an object's key is never also a folder of other objects.
 */
export function createS3Storage(opts: S3StorageOptions): Storage {
  const client = new S3Client({
    ...(opts.endpoint !== undefined && { endpoint: opts.endpoint }),
    region: opts.region,
    credentials: opts.credentials,
    forcePathStyle: opts.forcePathStyle,
  })
  const Bucket = opts.bucket
  const partSize = opts.partSize ?? S3_PART_SIZE

  async function exists(key: string): Promise<boolean> {
    try {
      await client.send(new HeadObjectCommand({ Bucket, Key: key }))
      return true
    } catch (error) {
      if (statusOf(error) === 404) return false
      throw error
    }
  }

  async function* pages(prefix: string): AsyncGenerator<_Object[]> {
    let token: string | undefined
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket,
          Prefix: prefix,
          MaxKeys: PAGE,
          ContinuationToken: token,
        }),
      )
      yield page.Contents ?? []
      token = page.IsTruncated === true ? page.NextContinuationToken : undefined
    } while (token !== undefined)
  }

  /** The disk cannot hold a file and a folder with one name: S3 is kept to the same rule. */
  async function refuseFolderClash(key: string): Promise<void> {
    const parts = key.split('/')
    // `org/<id>` is never an object: ancestors start one segment below the owner folder
    const ancestors = parts.slice(3).map((_, i) => parts.slice(0, 3 + i).join('/'))
    const [children, ...objects] = await Promise.all([
      client.send(new ListObjectsV2Command({ Bucket, Prefix: `${key}/`, MaxKeys: 1 })),
      ...ancestors.map(exists),
    ])
    if ((children.KeyCount ?? 0) > 0 || objects.includes(true)) throw invalid(key)
  }

  function bodyOf(found: GetObjectCommandOutput): Readable {
    if (!(found.Body instanceof Readable)) throw new Error('S3: risposta senza corpo')
    return found.Body
  }

  async function getObject(key: string, range?: string): Promise<GetObjectCommandOutput | null> {
    try {
      return await client.send(new GetObjectCommand({ Bucket, Key: key, Range: range }))
    } catch (error) {
      if (statusOf(error) === 404) return null
      throw error
    }
  }

  const storage: Storage = {
    async put(key, body, { contentType }) {
      checkKey(key)
      checkContentType(contentType)
      await refuseFolderClash(key)
      let size = 0
      async function* counted(source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
        for await (const chunk of source) {
          size += chunk.byteLength
          yield chunk
        }
      }
      const upload = new Upload({
        client,
        params: {
          Bucket,
          Key: key,
          ContentType: contentType,
          Body: Buffer.isBuffer(body) ? body : Readable.from(counted(body)),
        },
        partSize,
        queueSize: 2,
        // a failed multipart upload is aborted, so no part is left behind (ADR 021)
        leavePartsOnError: false,
      })
      await upload.done()
      return { size: Buffer.isBuffer(body) ? body.length : size }
    },

    async get(key) {
      checkKey(key)
      const found = await getObject(key)
      if (!found) return null
      return {
        body: bodyOf(found),
        size: found.ContentLength ?? 0,
        contentType: found.ContentType ?? 'application/octet-stream',
      }
    },

    async getRange(key, start, end) {
      checkKey(key)
      checkRange(start, end)
      let found
      try {
        found = await getObject(key, `bytes=${String(start)}-${String(end)}`)
      } catch (error) {
        if (statusOf(error) !== 416) throw error
        // past the end: the size and type still come back, for `Content-Range: bytes */size`
        const head = await client
          .send(new HeadObjectCommand({ Bucket, Key: key }))
          .catch((e: unknown) => {
            if (statusOf(e) === 404) return null
            throw e
          })
        if (!head) return null
        const empty: StoredObject = {
          body: Readable.from([]),
          size: head.ContentLength ?? 0,
          contentType: head.ContentType ?? 'application/octet-stream',
        }
        return { ...empty, range: null }
      }
      if (!found) return null
      const body = bodyOf(found)
      const contentType = found.ContentType ?? 'application/octet-stream'
      const match = CONTENT_RANGE.exec(found.ContentRange ?? '')
      if (match) {
        const [, first, last, total] = match.map(Number) as [number, number, number, number]
        return { body, size: total, contentType, range: { start: first, end: last } }
      }
      // a server may answer 200 with the whole object when the range covers it all
      const size = found.ContentLength ?? 0
      if (start !== 0 || size === 0) {
        body.destroy()
        throw new Error('S3: risposta senza Content-Range')
      }
      return { body, size, contentType, range: { start: 0, end: size - 1 } }
    },

    async delete(key) {
      checkKey(key)
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }))
    },

    async deletePrefix(prefix) {
      checkKey(prefix, PREFIX)
      let count = 0
      // collected first: deleting while paging would move the continuation token
      const keys: string[] = []
      for await (const page of pages(prefix))
        for (const object of page) if (object.Key !== undefined) keys.push(object.Key)
      for (let i = 0; i < keys.length; i += PAGE) {
        const batch = keys.slice(i, i + PAGE)
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        )
        if (result.Errors !== undefined && result.Errors.length > 0)
          throw new Error(
            `S3: ${String(result.Errors.length)} oggetti non cancellati (${result.Errors[0]?.Code ?? '?'})`,
          )
        count += batch.length
      }
      return count
    },

    async list(prefix) {
      checkKey(prefix, LIST_PREFIX)
      const listed: { key: string; size: number; modifiedAt: Date }[] = []
      for await (const page of pages(prefix))
        for (const object of page)
          if (object.Key !== undefined && KEY.test(object.Key))
            listed.push({
              key: object.Key,
              size: object.Size ?? 0,
              modifiedAt: object.LastModified ?? new Date(0),
            })
      return listed.sort(byKey)
    },
  }
  return storage
}

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createLocalDiskStorage } from '@app/infrastructure'
import { adminQuery } from './people.ts'

// Files of a library written straight into the database and the storage of the e2e server, as
// the worker leaves them once ready (plan 04 Task 10): a small real video plays in the browser.

const fixture = (name: string) => readFile(new URL(`../fixtures/${name}`, import.meta.url))

export interface LibraryFileSeed {
  kind: 'image' | 'video'
  name: string
  tags?: string[]
  folderId?: string | null
  /** default: ready */
  status?: 'ready' | 'processing' | 'failed'
  /** the JPEG of its thumbnail (and photo copy); default: a test card */
  image?: Buffer
  /** why a `failed` file failed; default: unreadable (no original kept) */
  failure?: 'unreadable' | 'timeout'
}

export async function libraryFile(
  organizationId: string,
  workspaceId: string,
  uploadedBy: string,
  file: LibraryFileSeed,
): Promise<string> {
  const root = process.env.E2E_MEDIA_ROOT
  if (!root) throw new Error('e2e media root not available')
  const storage = createLocalDiskStorage({ root })
  const id = randomUUID()
  const status = file.status ?? 'ready'
  const video = file.kind === 'video'
  await adminQuery(
    `insert into media (id, organization_id, workspace_id, uploaded_by, kind, status, original_name,
                        mime, size_bytes, width, height, duration_ms, fps, video_codec, audio_codec,
                        checks, failure, progress)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      id,
      organizationId,
      workspaceId,
      uploadedBy,
      file.kind,
      status,
      file.name,
      video ? 'video/quicktime' : 'image/heic',
      video ? 18_400_000 : 2_300_000,
      video ? 1080 : 3024,
      video ? 1920 : 4032,
      video ? 18_000 : null,
      video ? 30 : null,
      video ? 'hevc' : null,
      video ? 'aac' : null,
      status === 'ready'
        ? JSON.stringify(
            video
              ? { fixes: [{ code: 'faststart' }, { code: 'strip_metadata' }], warnings: [] }
              : {
                  fixes: [{ code: 'convert_to_jpeg' }, { code: 'strip_metadata' }],
                  warnings: [],
                },
          )
        : null,
      status === 'failed' ? JSON.stringify({ code: file.failure ?? 'unreadable' }) : null,
      status === 'processing' ? JSON.stringify({ step: 'conversion', percent: 40 }) : null,
    ],
  )
  await adminQuery(
    `insert into library_items (organization_id, workspace_id, media_id, folder_id, tags)
     values ($1, $2, $3, $4, $5)`,
    [organizationId, workspaceId, id, file.folderId ?? null, file.tags ?? []],
  )
  // a timeout keeps the original (ADR 021, P5): «Riprova» needs it
  if (status === 'failed' && file.failure === 'timeout') {
    const key = `org/${organizationId}/media/${id}/original.mov`
    await storage.put(key, await fixture('clip.mp4'), { contentType: 'video/quicktime' })
    await adminQuery('update media set storage_key = $2 where id = $1', [id, key])
  }
  if (status !== 'ready') return id
  const image = file.image ?? (await fixture('frame.jpg'))
  const copies = [
    { purpose: 'thumbnail', bytes: image, mime: 'image/jpeg', ext: 'jpg' },
    video
      ? { purpose: 'preview', bytes: await fixture('clip.mp4'), mime: 'video/mp4', ext: 'mp4' }
      : { purpose: 'ig_feed', bytes: image, mime: 'image/jpeg', ext: 'jpg' },
  ]
  for (const c of copies) {
    const key = `org/${organizationId}/media/${id}/${c.purpose}.${c.ext}`
    await storage.put(key, c.bytes, { contentType: c.mime })
    await adminQuery(
      `insert into media_variants (id, organization_id, media_id, purpose, storage_key, mime,
                                   size_bytes, width, height)
       values ($1, $2, $3, $4, $5, $6, $7, 240, 240)`,
      [randomUUID(), organizationId, id, c.purpose, key, c.mime, c.bytes.length],
    )
  }
  return id
}

import { z } from 'zod'
import { Id, OrgSlug, Timestamp } from './common.js'
import { FileResponse, defineContract } from './define.js'

// The files of a workspace (plan 04 Task 8). Editor and above (`media.upload`); for a Viewer,
// as for anyone without a role in the workspace, these routes answer 404 (spec §10.2).

const VariantPurpose = z.enum([
  'ig_feed',
  'fb_photo',
  'reel',
  'story',
  'thumbnail',
  'share',
  'preview',
  'cover',
  'master',
])

/** Never a storage key nor a public token. */
export const MediaDto = z.object({
  id: Id,
  kind: z.enum(['image', 'video']),
  status: z.enum(['uploading', 'processing', 'ready', 'failed']),
  originalName: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  fps: z.number().nullable(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  progress: z.object({ step: z.string(), percent: z.number() }).nullable(),
  /** why the file is `failed` (a block of §9.2 or what the worker found), with its details */
  failure: z
    .looseObject({
      code: z.enum([
        'unsupported_type',
        'too_large',
        'too_many_pixels',
        'too_long',
        'unreadable',
        'timeout',
        'storage_full',
        'processing_failed',
      ]),
    })
    .nullable(),
  /** once `ready`: what the worker corrected and what it proposes (§9.2) */
  checks: z
    .object({
      fixes: z.array(z.looseObject({ code: z.string() })),
      warnings: z.array(z.looseObject({ code: z.string() })),
    })
    .nullable(),
  uploadedBy: Id,
  createdAt: Timestamp,
  folderId: Id.nullable(),
  tags: z.array(z.string()),
  /**
   * A post that uses the file (D-18), the scheduled one first: the library's «Nel post del …».
   * A file of a scheduled post is not deleted (409).
   */
  usedIn: z
    .object({
      postId: Id,
      status: z.enum(['draft', 'scheduled', 'cancelled']),
      scheduledAt: Timestamp.nullable(),
    })
    .nullable(),
  variants: z.array(
    z.object({
      purpose: VariantPurpose,
      mime: z.string(),
      sizeBytes: z.number().int(),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
    }),
  ),
})

export type MediaDto = z.infer<typeof MediaDto>

const WorkspaceParams = z.strictObject({ org: OrgSlug, id: Id })
const MediaParams = z.strictObject({ org: OrgSlug, id: Id, mediaId: Id })

export const listMediaRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/media',
  summary:
    'I file dello spazio, dal più recente, con lo spazio occupato (copie e miniature comprese)',
  request: {
    params: WorkspaceParams,
    query: z.strictObject({
      before: Id.optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      kind: z.enum(['image', 'video']).optional(),
      /** a folder's files, right inside it; `none`: the files in no folder */
      folder: z.union([Id, z.literal('none')]).optional(),
      tag: z.string().max(100).optional(),
      /** a part of the file's name */
      q: z.string().max(200).optional(),
      /** «Nei post»: only the files a post uses, as a file or as its cover (D-18) */
      inPosts: z.enum(['true']).optional(),
    }),
  },
  response: z.object({
    items: z.array(MediaDto),
    next: Id.nullable(),
    usedBytes: z.number().int(),
    /** every tag of the library, by name: what the tag filter offers */
    tags: z.array(z.string()),
  }),
  auth: 'session',
  scope: 'organization',
})

export const getMediaRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/media/{mediaId}',
  summary: 'Un file dello spazio, con le sue copie',
  request: { params: MediaParams },
  response: MediaDto,
  auth: 'session',
  scope: 'organization',
})

export const deleteMediaRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/orgs/{org}/workspaces/{id}/media/{mediaId}',
  summary: 'Elimina un file dello spazio: sparisce subito, i file e le copie poco dopo',
  request: { params: MediaParams },
  response: z.object({ deleted: z.literal(true) }),
  auth: 'session',
  scope: 'organization',
})

export const retryMediaRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/media/{mediaId}/retry',
  summary:
    'Prepara di nuovo un file non riuscito che ha ancora l’originale (tempo scaduto, tentativi finiti)',
  request: { params: MediaParams },
  response: MediaDto,
  auth: 'session',
  scope: 'organization',
})

export const mediaFileRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/media/{mediaId}/file/{variant}',
  summary:
    'Una copia del file per il pannello, anteprima compresa, intera o a pezzi (Range, 206); mai l’originale',
  request: {
    params: z.strictObject({ org: OrgSlug, id: Id, mediaId: Id, variant: VariantPurpose }),
  },
  // the type of each answer is the copy's own (FileAnswer.contentType)
  download: { contentType: 'application/octet-stream', ranges: true },
  response: FileResponse,
  auth: 'session',
  scope: 'organization',
})

export const updateMediaRoute = defineContract({
  method: 'PATCH',
  path: '/api/v1/orgs/{org}/workspaces/{id}/media/{mediaId}',
  summary: 'Sposta un file in una cartella (null: fuori da tutte) e ne cambia i tag',
  request: {
    params: MediaParams,
    body: z.strictObject({
      folderId: Id.nullable().optional(),
      tags: z.array(z.string().max(100)).max(50).optional(),
    }),
  },
  response: MediaDto,
  auth: 'session',
  scope: 'organization',
})

/** A folder of the library (§11.8). */
export const LibraryFolder = z.object({
  id: Id,
  name: z.string(),
  parentId: Id.nullable(),
  /** files right inside it */
  fileCount: z.number().int(),
  createdAt: Timestamp,
})

export type LibraryFolder = z.infer<typeof LibraryFolder>

const FolderParams = z.strictObject({ org: OrgSlug, id: Id, folderId: Id })

export const listFoldersRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/folders',
  summary: 'Le cartelle della libreria dello spazio, per nome',
  request: { params: WorkspaceParams },
  response: z.object({ items: z.array(LibraryFolder) }),
  auth: 'session',
  scope: 'organization',
})

export const createFolderRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/folders',
  summary: 'Crea una cartella, in cima o dentro un’altra',
  request: {
    params: WorkspaceParams,
    body: z.strictObject({ name: z.string().max(200), parentId: Id.nullable() }),
  },
  response: LibraryFolder,
  auth: 'session',
  scope: 'organization',
})

export const updateFolderRoute = defineContract({
  method: 'PATCH',
  path: '/api/v1/orgs/{org}/workspaces/{id}/folders/{folderId}',
  summary: 'Rinomina una cartella o la sposta dentro un’altra (null: in cima)',
  request: {
    params: FolderParams,
    body: z.strictObject({
      name: z.string().max(200).optional(),
      parentId: Id.nullable().optional(),
    }),
  },
  response: LibraryFolder,
  auth: 'session',
  scope: 'organization',
})

export const deleteFolderRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/orgs/{org}/workspaces/{id}/folders/{folderId}',
  summary:
    'Elimina una cartella: vuota subito, altrimenti con confirm=true, e quello che contiene passa nella cartella sopra',
  request: {
    params: FolderParams,
    query: z.strictObject({ confirm: z.enum(['true', 'false']).optional() }),
  },
  response: z.object({ deleted: z.literal(true) }),
  auth: 'session',
  scope: 'organization',
})

export const mediaRoutes = [
  listMediaRoute,
  getMediaRoute,
  updateMediaRoute,
  deleteMediaRoute,
  retryMediaRoute,
  mediaFileRoute,
  listFoldersRoute,
  createFolderRoute,
  updateFolderRoute,
  deleteFolderRoute,
] as const

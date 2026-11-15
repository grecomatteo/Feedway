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
  uploadedBy: Id,
  createdAt: Timestamp,
  folderId: Id.nullable(),
  tags: z.array(z.string()),
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
    }),
  },
  response: z.object({
    items: z.array(MediaDto),
    next: Id.nullable(),
    usedBytes: z.number().int(),
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

export const mediaRoutes = [
  listMediaRoute,
  getMediaRoute,
  deleteMediaRoute,
  mediaFileRoute,
] as const

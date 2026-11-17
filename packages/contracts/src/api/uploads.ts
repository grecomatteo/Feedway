import { z } from 'zod'
import { Id, OrgSlug, Timestamp } from './common.js'
import { defineContract } from './define.js'
import { MediaDto } from './media.js'

// The upload in pieces (ADR 021, plan 04 Task 9): one session per file, pieces of 20 MiB with
// their sha-256, then `complete`. Only the person who started an upload sees it; for anyone
// else, as for a Viewer, these routes answer 404.

/** 20 MiB, as UPLOAD_PART_BYTES in @app/domain (contracts depend on zod only). */
export const UPLOAD_PART_MAX_BYTES = 20 * 1024 * 1024

export const UploadDto = z.object({
  id: Id,
  name: z.string(),
  type: z.string(),
  sizeBytes: z.number().int(),
  folderId: Id.nullable(),
  firstPartSha256: z.string(),
  partBytes: z.number().int(),
  partCount: z.number().int(),
  received: z.array(z.number().int()),
  expiresAt: Timestamp,
  mediaId: Id.nullable(),
})

export type UploadDto = z.infer<typeof UploadDto>

const WorkspaceParams = z.strictObject({ org: OrgSlug, id: Id })
const UploadParams = z.strictObject({ org: OrgSlug, id: Id, uploadId: Id })

export const startUploadRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/uploads',
  summary:
    'Comincia il caricamento di una foto o di un video: prenota lo spazio e dice in quanti pezzi mandarlo',
  request: {
    params: WorkspaceParams,
    body: z.strictObject({
      // shown only, never part of a path
      name: z.string().min(1).max(255),
      type: z.string().max(100),
      sizeBytes: z.number().int().min(1),
      // hex sha-256 of the first piece: recognises the same file chosen again after a reload
      firstPartSha256: z.string().regex(/^[0-9a-f]{64}$/),
      folderId: Id.nullable().optional(),
    }),
  },
  response: UploadDto,
  auth: 'session',
  scope: 'organization',
})

export const listUploadsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/uploads',
  summary:
    'I tuoi caricamenti rimasti a metà in questo spazio, da riprendere, e i limiti di peso dei file',
  request: { params: WorkspaceParams },
  response: z.object({
    items: z.array(UploadDto),
    // the panel refuses a file over its kind's limit at once, without starting it
    limits: z.object({ maxImageBytes: z.number().int(), maxVideoBytes: z.number().int() }),
  }),
  auth: 'session',
  scope: 'organization',
})

export const getUploadRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/uploads/{uploadId}',
  summary: 'Un tuo caricamento, con i pezzi già arrivati',
  request: { params: UploadParams },
  response: UploadDto,
  auth: 'session',
  scope: 'organization',
})

export const uploadPartRoute = defineContract({
  method: 'PUT',
  path: '/api/v1/orgs/{org}/workspaces/{id}/uploads/{uploadId}/parts/{n}',
  summary:
    'Manda il pezzo n (da 1) del file, con la sua impronta sha-256: lo stesso pezzo di nuovo non cambia niente',
  request: {
    params: z.strictObject({
      org: OrgSlug,
      id: Id,
      uploadId: Id,
      n: z.coerce.number().int().min(1).max(10_000),
    }),
  },
  binary: { maxBytes: UPLOAD_PART_MAX_BYTES },
  response: UploadDto,
  auth: 'session',
  scope: 'organization',
})

/**
 * The file made, and the one of the same workspace with the same content (sha256) if there is
 * one: the panel says so and leaves the choice (D-42).
 */
export const CompletedUploadDto = MediaDto.extend({
  duplicateOf: z.object({ id: z.uuid(), name: z.string() }).nullable(),
})
export type CompletedUploadDto = z.infer<typeof CompletedUploadDto>

export const completeUploadRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/uploads/{uploadId}/complete',
  summary:
    'Chiude il caricamento: il file entra nella libreria e si prepara; una seconda chiamata dà lo stesso file',
  request: { params: UploadParams },
  response: CompletedUploadDto,
  auth: 'session',
  scope: 'organization',
})

export const cancelUploadRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/orgs/{org}/workspaces/{id}/uploads/{uploadId}',
  summary: 'Annulla un caricamento non completato: i pezzi si cancellano e lo spazio si libera',
  request: { params: UploadParams },
  response: z.object({ deleted: z.literal(true) }),
  auth: 'session',
  scope: 'organization',
})

export const uploadRoutes = [
  startUploadRoute,
  listUploadsRoute,
  getUploadRoute,
  uploadPartRoute,
  completeUploadRoute,
  cancelUploadRoute,
] as const

import { z } from 'zod'
import { defineContract, FileResponse } from './define.js'
import { Id } from './common.js'
import { Me } from './me.js'

/** As AVATAR_MAX_BYTES of the domain: the use case checks it again with its own message. */
const AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024
const WEBP = { contentType: 'image/webp' } as const

export const AvatarSource = z.object({
  stagingId: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  /** The preview to crop, readable only by the person who uploaded it. */
  previewUrl: z.string(),
})
export type AvatarSource = z.infer<typeof AvatarSource>

export const uploadAvatarRoute = defineContract({
  method: 'POST',
  path: '/api/v1/me/avatar',
  summary: 'Carica una foto profilo da ritagliare (JPEG, PNG, WebP o HEIC, al massimo 5 MB)',
  request: {},
  upload: { maxBytes: AVATAR_UPLOAD_BYTES },
  response: AvatarSource,
  auth: 'session',
  scope: 'personal',
})

export const avatarStagingRoute = defineContract({
  method: 'GET',
  path: '/api/v1/me/avatar/staging/{id}',
  summary: 'L’anteprima della foto caricata, per il ritaglio',
  request: { params: z.strictObject({ id: Id }) },
  download: WEBP,
  response: FileResponse,
  auth: 'session',
  scope: 'personal',
})

export const cropAvatarRoute = defineContract({
  method: 'POST',
  path: '/api/v1/me/avatar/crop',
  summary: 'Ritaglia la foto caricata: diventa la foto profilo',
  request: {
    body: z.strictObject({
      stagingId: Id,
      x: z.number().int().min(0).max(100_000),
      y: z.number().int().min(0).max(100_000),
      size: z.number().int().min(1).max(100_000),
    }),
  },
  response: Me,
  auth: 'session',
  scope: 'personal',
})

export const removeAvatarRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/me/avatar',
  summary: 'Toglie la foto profilo: tornano le iniziali',
  request: {},
  response: Me,
  auth: 'session',
  scope: 'personal',
})

/**
 * Only for the person and for colleagues of an agency where both are active members; anyone
 * else gets 404. `v` is the hash of the photo, so a new photo is never read from a cache.
 */
export const userAvatarRoute = defineContract({
  method: 'GET',
  path: '/api/v1/users/{id}/avatar/{size}',
  summary: 'La foto profilo di una persona (256 o 64 px)',
  request: {
    params: z.strictObject({ id: z.string().max(64), size: z.enum(['256', '64']) }),
    query: z.strictObject({ v: z.string().max(64).optional() }),
  },
  download: WEBP,
  response: FileResponse,
  auth: 'session',
  scope: 'personal',
})

export const avatarRoutes = [
  uploadAvatarRoute,
  avatarStagingRoute,
  cropAvatarRoute,
  removeAvatarRoute,
  userAvatarRoute,
] as const

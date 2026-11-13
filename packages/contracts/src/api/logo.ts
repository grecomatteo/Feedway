import { z } from 'zod'
import { defineContract, FileResponse } from './define.js'
import { Id, OrgParams } from './common.js'

/** As LOGO_MAX_BYTES of the domain: the use case checks it again with its own message. */
const LOGO_UPLOAD_BYTES = 5 * 1024 * 1024
const WEBP = { contentType: 'image/webp' } as const

export const LogoSource = z.object({
  stagingId: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  /** The preview, readable only by the Owner of the agency. */
  previewUrl: z.string(),
})
export type LogoSource = z.infer<typeof LogoSource>

export const AgencyLogo = z.object({
  /** The 256 px logo in the panel (`/64` for the small one); null: the initials. */
  logoUrl: z.string().nullable(),
})
export type AgencyLogo = z.infer<typeof AgencyLogo>

export const uploadLogoRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/logo',
  summary:
    'Carica il logo dell’agenzia da confermare (JPEG, PNG, WebP o HEIC, al massimo 5 MB; Owner, con riconferma)',
  request: { params: OrgParams },
  upload: { maxBytes: LOGO_UPLOAD_BYTES },
  response: LogoSource,
  auth: 'session',
  scope: 'organization',
})

export const logoStagingRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/logo/staging/{stagingId}',
  summary: 'L’anteprima del logo caricato, prima della conferma (Owner)',
  request: { params: OrgParams.extend({ stagingId: Id }) },
  download: WEBP,
  response: FileResponse,
  auth: 'session',
  scope: 'organization',
})

export const confirmLogoRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/logo/confirm',
  summary: 'Il logo caricato diventa quello dell’agenzia (Owner, con riconferma)',
  request: { params: OrgParams, body: z.strictObject({ stagingId: Id }) },
  response: AgencyLogo,
  auth: 'session',
  scope: 'organization',
})

export const removeLogoRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/orgs/{org}/logo',
  summary: 'Toglie il logo: tornano le iniziali (Owner, con riconferma)',
  request: { params: OrgParams },
  response: AgencyLogo,
  auth: 'session',
  scope: 'organization',
})

/**
 * For every active member of the agency, from the panel only (never the public host). `v` is
 * the hash of the logo, so a new logo is never read from a cache.
 */
export const agencyLogoRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/logo/{size}',
  summary: 'Il logo dell’agenzia (256 o 64 px), per i suoi membri',
  request: {
    params: OrgParams.extend({ size: z.enum(['256', '64']) }),
    query: z.strictObject({ v: z.string().max(64).optional() }),
  },
  download: WEBP,
  response: FileResponse,
  auth: 'session',
  scope: 'organization',
})

export const logoRoutes = [
  uploadLogoRoute,
  logoStagingRoute,
  confirmLogoRoute,
  removeLogoRoute,
  agencyLogoRoute,
] as const

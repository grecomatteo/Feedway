import { z } from 'zod'
import { Id } from './common.js'
import { defineContract, FileResponse } from './define.js'

export const DataExport = z.object({
  id: z.string(),
  status: z.enum(['pending', 'running', 'ready', 'failed', 'expired']),
  createdAt: z.string(),
  /** When the file stops being downloadable; null until it is ready. */
  expiresAt: z.string().nullable(),
})
export type DataExport = z.infer<typeof DataExport>

export const requestDataExportRoute = defineContract({
  method: 'POST',
  path: '/api/v1/me/exports',
  summary:
    'Scarica i miei dati: prepara l’archivio (uno alla volta, al massimo 3 richieste in 24 ore)',
  request: {},
  response: DataExport,
  auth: 'session',
  scope: 'personal',
})

export const listDataExportsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/me/exports',
  summary: 'Le ultime richieste dei miei dati, con stato e scadenza',
  request: {},
  response: z.object({ items: z.array(DataExport) }),
  auth: 'session',
  scope: 'personal',
})

/** Only for the owner (anyone else: 404); 24 hours after it is ready, 410. */
export const downloadDataExportRoute = defineContract({
  method: 'GET',
  path: '/api/v1/me/exports/{id}/download',
  summary: 'L’archivio dei miei dati (ZIP), per 24 ore',
  request: { params: z.strictObject({ id: Id }) },
  download: { contentType: 'application/zip' },
  response: FileResponse,
  auth: 'session',
  scope: 'personal',
})

export const privacyRoutes = [
  requestDataExportRoute,
  listDataExportsRoute,
  downloadDataExportRoute,
] as const

import { z } from 'zod'
import { defineContract } from './define.js'
import { OrgParams, Timestamp } from './common.js'

// Impostazioni → Integrazioni → Meta (spec §8.3, plan 03 Task 4). The App Secret goes in and
// never comes back: a stored integration always has one, so the answer only says it is there.

/** The agency's Meta app as Owner and Admin see it. */
export const MetaIntegration = z.object({
  appId: z.string(),
  /** The unified login's configuration (ADR 020); null until the Owner sets it. */
  configId: z.string().nullable(),
  /** The Business Manager of the system user; Meta gives no way to read it with its token. */
  businessId: z.string().nullable(),
  /** YYYY-MM-DD; may stay empty while the app is in development. */
  dataUseCheckupDueOn: z.string().nullable(),
  /** The last time Meta accepted App ID and secret. */
  verifiedAt: Timestamp.nullable(),
  /** Meta refused App ID and secret (a test, or a job's call) since the last save or success. */
  rejectedAt: Timestamp.nullable(),
  updatedAt: Timestamp,
})
export type MetaIntegration = z.infer<typeof MetaIntegration>

export const metaIntegrationRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/integrations/meta',
  summary: 'L’app Meta dell’agenzia, senza il secret (Owner; Admin in sola lettura)',
  request: { params: OrgParams },
  response: z.object({ integration: MetaIntegration.nullable() }),
  auth: 'session',
  scope: 'organization',
})

const MetaId = z.string().max(64)

/** Replaced as a whole: a field left out is cleared, except the secret. */
export const ReplaceMetaIntegrationBody = z.strictObject({
  appId: MetaId,
  /** Left out or empty: the stored secret stays. */
  appSecret: z.string().max(1024).optional(),
  configId: MetaId.nullable().optional(),
  businessId: MetaId.nullable().optional(),
  dataUseCheckupDueOn: z.string().max(10).nullable().optional(),
})

export const replaceMetaIntegrationRoute = defineContract({
  method: 'PUT',
  path: '/api/v1/orgs/{org}/integrations/meta',
  summary:
    'Cambia l’app Meta dell’agenzia (Owner, con riconferma): si salva solo se Meta la accetta',
  request: { params: OrgParams, body: ReplaceMetaIntegrationBody },
  response: z.object({ integration: MetaIntegration }),
  auth: 'session',
  scope: 'organization',
})

export const MetaTestResult = z.enum(['verified', 'not_configured', 'rejected', 'unavailable'])

export const testMetaIntegrationRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/integrations/meta/test',
  summary: '«Prova»: chiede a Meta se App ID e secret salvati sono validi (Owner)',
  request: { params: OrgParams },
  response: z.object({ ok: z.boolean(), result: MetaTestResult }),
  auth: 'session',
  scope: 'organization',
})

export const integrationRoutes = [
  metaIntegrationRoute,
  replaceMetaIntegrationRoute,
  testMetaIntegrationRoute,
] as const

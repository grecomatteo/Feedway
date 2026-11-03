import { z } from 'zod'
import { defineContract } from './define.js'
import { OrgParams, TwoFactorPolicy } from './common.js'

export const OrganizationSettings = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  require2fa: TwoFactorPolicy.nullable(),
  platformRequire2fa: TwoFactorPolicy,
  privacy: z
    .object({
      controllerName: z.string(),
      contactEmail: z.string(),
      extraText: z.string().optional(),
    })
    .nullable(),
})

export const organizationSettingsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/settings',
  summary: 'Le impostazioni dell’agenzia',
  request: { params: OrgParams },
  response: OrganizationSettings,
  auth: 'session',
  scope: 'organization',
})

/** Only these: the slug, status and limits are never changed from here. */
export const UpdateOrganizationSettingsBody = z.strictObject({
  name: z.string().max(400).optional(),
  require2fa: TwoFactorPolicy.optional(),
  /** The controller data of the privacy notice, replaced as a whole. */
  privacy: z
    .strictObject({
      controllerName: z.string().max(1000),
      contactEmail: z.string().max(1000),
      extraText: z.string().max(10_000).optional(),
    })
    .optional(),
})

export const updateOrganizationSettingsRoute = defineContract({
  method: 'PATCH',
  path: '/api/v1/orgs/{org}/settings',
  summary:
    'Cambia nome, regola del secondo fattore e titolare dell’informativa (Owner, con riconferma)',
  request: { params: OrgParams, body: UpdateOrganizationSettingsBody },
  response: OrganizationSettings,
  auth: 'session',
  scope: 'organization',
})

export const PrivacyNotice = z.object({
  organizationName: z.string().nullable(),
  controllerName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  extraText: z.string().nullable(),
  /** The periods the code applies, in milliseconds (`RETENTION`). */
  retention: z.object({
    expiredSessionsMs: z.number(),
    knownDevicesMs: z.number(),
    auditIpMs: z.number(),
    disabledUserMs: z.number(),
    anonymizationNoticeMs: z.number(),
    dataExportMs: z.number(),
    avatarStagingMs: z.number(),
  }),
  cookies: z.array(
    z.object({
      name: z.string(),
      purpose: z.enum(['session', 'second_factor', 'passkey', 'device', 'theme']),
      maxAgeSeconds: z.number().nullable(),
    }),
  ),
})
export type PrivacyNotice = z.infer<typeof PrivacyNotice>

export const publicPrivacyNoticeRoute = defineContract({
  method: 'GET',
  path: '/api/v1/privacy',
  summary: 'L’informativa privacy del pannello, anche senza accesso',
  request: {},
  response: PrivacyNotice,
  auth: 'public',
  scope: 'public',
})

export const organizationPrivacyNoticeRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/privacy',
  summary: 'L’informativa privacy dell’agenzia, per i suoi membri',
  request: { params: OrgParams },
  response: PrivacyNotice,
  auth: 'session',
  scope: 'organization',
})

export const organizationRoutes = [
  organizationSettingsRoute,
  updateOrganizationSettingsRoute,
  publicPrivacyNoticeRoute,
  organizationPrivacyNoticeRoute,
] as const

import { z } from 'zod'
import { defineContract } from './define.js'
import { OrgParams, TwoFactorPolicy } from './common.js'

export const OrganizationSettings = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  require2fa: TwoFactorPolicy.nullable(),
  platformRequire2fa: TwoFactorPolicy,
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

/** Only these two: the slug, status and limits are never changed from here. */
export const UpdateOrganizationSettingsBody = z.strictObject({
  name: z.string().max(400).optional(),
  require2fa: TwoFactorPolicy.optional(),
})

export const updateOrganizationSettingsRoute = defineContract({
  method: 'PATCH',
  path: '/api/v1/orgs/{org}/settings',
  summary: 'Cambia nome e regola del secondo fattore dell’agenzia (Owner, con riconferma)',
  request: { params: OrgParams, body: UpdateOrganizationSettingsBody },
  response: OrganizationSettings,
  auth: 'session',
  scope: 'organization',
})

export const organizationRoutes = [
  organizationSettingsRoute,
  updateOrganizationSettingsRoute,
] as const

import { z } from 'zod'
import { defineContract } from './define.js'
import { Id, OrgRole, Timestamp } from './common.js'

const MyOrganization = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  role: OrgRole,
  status: z.enum(['active', 'suspended']),
})

/** The signed-in person: their own data only, never a hash, token or secret. */
export const Me = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  nickname: z.string().nullable(),
  displayName: z.string(),
  platformRole: z.literal('admin').nullable(),
  avatarUrl: z.string().nullable(),
  theme: z.enum(['light', 'dark', 'system']),
  locale: z.string(),
  timezone: z.string().nullable(),
  lastOrganizationSlug: z.string().nullable(),
  organizations: z.array(MyOrganization),
  secondFactor: z.object({
    required: z.boolean(),
    totpEnabled: z.boolean(),
    passkeys: z.number().int(),
  }),
  /** `second_factor_required`: the panel shows only the second factor setup. */
  sessionState: z.enum(['active', 'second_factor_required']),
})
export type Me = z.infer<typeof Me>

export const meRoute = defineContract({
  method: 'GET',
  path: '/api/v1/me',
  summary: 'La persona collegata e lo stato della sessione',
  request: {},
  response: Me,
  // also while the second factor is owed: the gate lets it through only before any factor exists
  auth: 'session_any_state',
  scope: 'personal',
})

export const myOrganizationsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/me/organizations',
  summary: 'Le agenzie della persona, per il selettore',
  request: {},
  response: z.object({ items: z.array(MyOrganization) }),
  auth: 'session',
  scope: 'personal',
})

export const PasskeySummary = z.object({
  id: z.string(),
  name: z.string().nullable(),
  createdAt: Timestamp.nullable(),
  deviceType: z.enum(['singleDevice', 'multiDevice']),
  backedUp: z.boolean(),
})

export const mySecondFactorRoute = defineContract({
  method: 'GET',
  path: '/api/v1/me/second-factor',
  summary: 'I secondi fattori della persona e se sono obbligatori',
  request: {},
  response: z.object({
    required: z.boolean(),
    totpEnabled: z.boolean(),
    passkeys: z.array(PasskeySummary),
  }),
  auth: 'session',
  scope: 'personal',
})

/** A signed-in device: never the token, never the full address. */
export const MySession = z.object({
  id: z.string(),
  device: z.object({ browser: z.string(), os: z.string() }),
  ipApprox: z.string().nullable(),
  createdAt: Timestamp,
  lastActiveAt: Timestamp,
  current: z.boolean(),
})

export const mySessionsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/me/sessions',
  summary: 'I dispositivi collegati',
  request: {},
  response: z.object({ items: z.array(MySession) }),
  auth: 'session',
  scope: 'personal',
})

export const revokeMySessionRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/me/sessions/{id}',
  summary: 'Scollega un dispositivo',
  request: { params: z.strictObject({ id: Id }) },
  response: z.object({ revoked: z.literal(true) }),
  auth: 'session',
  scope: 'personal',
})

export const revokeAllMySessionsRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/me/sessions',
  summary: 'Esce da tutti i dispositivi, questo compreso',
  request: {},
  response: z.object({ revoked: z.number().int() }),
  auth: 'session',
  scope: 'personal',
})

export const meRoutes = [
  meRoute,
  myOrganizationsRoute,
  mySecondFactorRoute,
  mySessionsRoute,
  revokeMySessionRoute,
  revokeAllMySessionsRoute,
] as const

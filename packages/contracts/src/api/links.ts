import { z } from 'zod'
import { defineContract } from './define.js'

// the links of invites and security emails carry 32 random bytes; anything longer is not ours
const LinkToken = z.strictObject({ token: z.string().min(1).max(256) })

export const LinkDescription = z.object({
  purpose: z.enum(['bootstrap', 'invite', 'organization_owner']),
  email: z.string(),
  organizationName: z.string().nullable(),
  existingUser: z.boolean(),
})
export type LinkDescription = z.infer<typeof LinkDescription>

export const describeLinkRoute = defineContract({
  method: 'GET',
  path: '/api/v1/links/{token}',
  summary: 'Cosa mostra la pagina di attivazione prima del modulo',
  request: { params: LinkToken },
  response: LinkDescription,
  auth: 'public',
  scope: 'public',
})

/** An existing account sends nothing: the invite never changes its name or credentials. */
export const ActivateBody = z.strictObject({
  name: z.string().max(400).default(''),
  nickname: z.string().max(400).nullable().default(null),
  /** null chooses the passkey */
  password: z.string().max(1024).nullable().default(null),
})

export const ActivateResponse = z.object({
  organizationSlug: z.string(),
  next: z.enum(['done', 'register_passkey']),
})
export type ActivateResponse = z.infer<typeof ActivateResponse>

export const activateLinkRoute = defineContract({
  method: 'POST',
  path: '/api/v1/links/{token}/activate',
  summary: 'Attiva l’account o accetta l’invito',
  request: { params: LinkToken, body: ActivateBody },
  response: ActivateResponse,
  auth: 'public',
  scope: 'public',
})

export const completeLinkRoute = defineContract({
  method: 'POST',
  path: '/api/v1/links/{token}/complete',
  summary: 'Chiude il link dopo la registrazione della passkey',
  request: { params: LinkToken },
  response: z.object({ done: z.literal(true) }),
  auth: 'session_any_state',
  scope: 'personal',
})

export const securityLockRoute = defineContract({
  method: 'POST',
  path: '/api/v1/security/lock',
  summary: 'Blocca l’account dal link "Non sono stato io" di un’email di sicurezza',
  request: { body: z.strictObject({ token: z.string().min(1).max(512) }) },
  response: z.object({ locked: z.literal(true) }),
  auth: 'public',
  scope: 'public',
})

export const linkRoutes = [
  describeLinkRoute,
  activateLinkRoute,
  completeLinkRoute,
  securityLockRoute,
] as const

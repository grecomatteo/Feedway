import { z } from 'zod'
import { defineContract } from './define.js'

export const reauthRoute = defineContract({
  method: 'POST',
  path: '/api/v1/auth/reauth',
  summary: 'Conferma l’identità con la password prima di un’azione delicata',
  request: { body: z.strictObject({ password: z.string().min(1).max(1024) }) },
  response: z.object({ reauthenticated: z.literal(true) }),
  auth: 'session',
  scope: 'personal',
})

export const authRoutes = [reauthRoute] as const

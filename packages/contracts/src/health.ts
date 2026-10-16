import { z } from 'zod'

export const HealthResponse = z.object({ status: z.literal('ok'), version: z.string() })
export type HealthResponse = z.infer<typeof HealthResponse>

const componentState = z.enum(['ok', 'error'])

export const ReadyResponse = z.object({ db: componentState, queue: componentState })
export type ReadyResponse = z.infer<typeof ReadyResponse>

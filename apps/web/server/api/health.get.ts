import type { HealthResponse } from '@app/contracts'

export default defineEventHandler((): HealthResponse => {
  return { status: 'ok', version: process.env['APP_VERSION'] ?? 'dev' }
})

import type { ReadyResponse } from '@app/contracts'

const CHECK_TIMEOUT_MS = 2000

async function check(probe: () => Promise<unknown>): Promise<'ok' | 'error'> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('timeout'))
        }, CHECK_TIMEOUT_MS)
      }),
    ])
    return 'ok'
  } catch {
    // no detail in the response: the cause is in the logs of the failing component
    return 'error'
  } finally {
    clearTimeout(timer)
  }
}

export default defineEventHandler(async (event): Promise<ReadyResponse> => {
  const { pool, queue } = useDeps()
  const [db, queueState] = await Promise.all([
    check(() => pool.query('select 1')),
    check(() => queue.ping()),
  ])
  const body = { db, queue: queueState }
  if (db === 'error' || queueState === 'error') setResponseStatus(event, 503)
  return body
})

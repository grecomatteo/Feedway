// Which failures of the database pass on their own (R2 of the tappa 8 review): the work that
// met one may simply be tried again, unlike an error of its data. The driver's errors come
// wrapped (drizzle puts the pg error in `cause`), so the whole chain is read.

/** SQLSTATE: connection exception (class 08) and operator intervention (class 57P). */
const TRANSIENT_CLASSES = ['08', '57P']
const TRANSIENT_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '53300', // too_many_connections
  '55P03', // lock_not_available
])
/** The socket under the connection, as Node names it. */
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN'])
/** pg-pool and pg say these in words only. */
const TRANSIENT_MESSAGES = [
  'timeout exceeded when trying to connect',
  'Connection terminated',
  'Client has encountered a connection error',
]

function transientOne(error: Error): boolean {
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string') {
    if (TRANSIENT_CODES.has(code) || NETWORK_CODES.has(code)) return true
    if (TRANSIENT_CLASSES.some((c) => code.startsWith(c))) return true
  }
  return TRANSIENT_MESSAGES.some((m) => error.message.includes(m))
}

export function isTransientDbError(error: unknown): boolean {
  // a few levels are enough, and a cycle of causes ends here
  let current: unknown = error
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (transientOne(current)) return true
    current = current.cause
  }
  return false
}

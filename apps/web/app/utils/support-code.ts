const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Adds the request id to the message of an unexpected error, which asks the person to pass it on. */
export function withSupportCode(message: string, code: string, requestId: unknown): string {
  if (code !== 'INTERNAL' || typeof requestId !== 'string' || !UUID.test(requestId)) return message
  return `${message} Codice: ${requestId}`
}

export type SmtpFailureKind =
  /** The settings cannot be used as they are (host, port, sender, recipient). */
  | 'invalid_config'
  /** The host resolves to an address we never connect to (loopback, private networks...). */
  | 'blocked_destination'
  | 'dns'
  | 'timeout'
  /** No TLS, or a certificate that does not verify. */
  | 'tls'
  | 'auth'
  | 'connection'
  /** The server answered but refused the sender, the recipient or the message. */
  | 'rejected'

const RESPONSE_MAX = 200

/**
 * A failed send, classified. The message never holds the username, the password, the recipient
 * or the body: only the kind and, when the server answered, its reply cut short.
 */
export class SmtpSendError extends Error {
  readonly kind: SmtpFailureKind
  /** The server's reply, on one line, at most 200 characters, credentials removed. */
  readonly response: string | undefined

  constructor(kind: SmtpFailureKind, response?: string) {
    super(response === undefined ? `smtp ${kind}` : `smtp ${kind}: ${response}`)
    this.name = 'SmtpSendError'
    this.kind = kind
    this.response = response
  }
}

/** One line, without the given secrets, cut to 200 characters. */
export function safeResponse(text: string, secrets: readonly string[]): string {
  let out = text.replace(/[\r\n\t]+/g, ' ')
  for (const s of secrets) if (s.length > 0) out = out.split(s).join('[REDACTED]')
  // a secret cut in half by the limit would still leak its start: remove, then cut
  return out.length > RESPONSE_MAX ? `${out.slice(0, RESPONSE_MAX)}…` : out
}

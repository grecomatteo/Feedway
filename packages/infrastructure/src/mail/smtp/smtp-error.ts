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

// Anything shaped like an address: servers echo the sender and the recipients.
const EMAIL = /[^\s<>"'(),;:@[\]]+@[^\s<>"'(),;:@[\]]+/g

const base64Forms = (value: string) => {
  const b = Buffer.from(value, 'utf8').toString('base64')
  return [b, b.replace(/=+$/, '')]
}

/**
 * One line, without the username and the secret (in clear, in base64, as the AUTH PLAIN and
 * LOGIN exchanges send them) and without email addresses, cut to 200 characters.
 */
export function safeResponse(
  text: string,
  credentials: { username: string; secret: string },
): string {
  const { username: u, secret: s } = credentials
  const forms = [
    s,
    u,
    ...base64Forms(s),
    ...base64Forms(u),
    ...base64Forms(`\u0000${u}\u0000${s}`),
    ...base64Forms(`${u}\u0000${u}\u0000${s}`),
  ]
    .filter((f) => f.length > 0)
    // longest first: a shorter form inside a longer one must not leave the rest behind
    .sort((a, b) => b.length - a.length)
  let out = text.replace(/[\u0000-\u001f\u007f]+/g, ' ')
  for (const f of forms) out = out.split(f).join('[REDACTED]')
  out = out.replace(EMAIL, '[email]')
  // a secret cut in half by the limit would still leak its start: remove, then cut
  return out.length > RESPONSE_MAX ? `${out.slice(0, RESPONSE_MAX)}…` : out
}

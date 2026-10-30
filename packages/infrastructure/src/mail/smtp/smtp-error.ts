import { MailSendError } from '@app/application'
import type { MailFailureKind } from '@app/application'

/** The kinds of the port (`MAIL_FAILURE_KINDS`): the panel and the CLI read them. */
export type SmtpFailureKind = MailFailureKind

const RESPONSE_MAX = 200
const INPUT_MAX = 2_000

/**
 * A failed send, classified. The message never holds the username, the password, the recipient
 * or the body: only the kind and, when the server answered, its reply cut short.
 */
export class SmtpSendError extends MailSendError {
  constructor(kind: SmtpFailureKind, response?: string) {
    super(kind, response, 'smtp')
    this.name = 'SmtpSendError'
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
  // bounded first: a hostile server's huge reply must not make the patterns below slow
  let out = text.slice(0, INPUT_MAX).replace(/[\u0000-\u001f\u007f]+/g, ' ')
  for (const f of forms) out = out.split(f).join('[REDACTED]')
  out = out.replace(EMAIL, '[email]')
  // a secret cut in half by the limit would still leak its start: remove, then cut
  return out.length > RESPONSE_MAX ? `${out.slice(0, RESPONSE_MAX)}…` : out
}

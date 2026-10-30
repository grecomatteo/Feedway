export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
  /** A single plain address for replies (an invite: whoever invites). */
  replyTo?: string
}

/**
 * Outgoing email, always with the platform's SMTP and in the product's name (ADR 017): agencies
 * configure nothing. In production the settings are read at every send; without them the
 * message is dropped and the answer is `not_configured`.
 */
export interface Mailer {
  isConfigured(): Promise<boolean>
  send(message: MailMessage): Promise<'sent' | 'not_configured'>
}

/** Why an email did not leave, as the adapter classifies it (ADR 017). */
export const MAIL_FAILURE_KINDS = [
  /** The settings cannot be used as they are (host, port, sender, recipient). */
  'invalid_config',
  /** The host resolves to an address we never connect to (loopback, private networks...). */
  'blocked_destination',
  'dns',
  'timeout',
  /** No TLS, or a certificate that does not verify. */
  'tls',
  'auth',
  'connection',
  /** The server answered but refused the sender, the recipient or the message. */
  'rejected',
] as const
export type MailFailureKind = (typeof MAIL_FAILURE_KINDS)[number]

/**
 * A failed send, classified. The message never holds the username, the password, the recipient
 * or the body: only the kind and, when the server answered, its reply already cleaned.
 */
export class MailSendError extends Error {
  readonly kind: MailFailureKind
  /** The server's reply, on one line, at most 200 characters, credentials and addresses removed. */
  readonly response: string | undefined

  constructor(kind: MailFailureKind, response?: string, prefix = 'mail') {
    super(response === undefined ? `${prefix} ${kind}` : `${prefix} ${kind}: ${response}`)
    this.name = 'MailSendError'
    this.kind = kind
    this.response = response
  }
}

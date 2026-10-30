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

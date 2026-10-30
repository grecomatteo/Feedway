export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
}

/**
 * Whose settings send the email: an agency's (with fallback to the platform default) or the
 * platform's (`null`: security emails, password reset, recovery, lock notices).
 */
export interface MailSender {
  organizationId: string | null
}

/** Security emails, reset, recovery and lock notices always leave with the platform's settings. */
export const PLATFORM_SENDER: MailSender = Object.freeze({ organizationId: null })

/**
 * Outgoing email. In production the SMTP settings are read at every send (agency, else
 * platform); without any, the message is dropped and the answer is `not_configured`.
 */
export interface Mailer {
  isConfigured(organizationId: string | null): Promise<boolean>
  send(message: MailMessage, sender: MailSender): Promise<'sent' | 'not_configured'>
}

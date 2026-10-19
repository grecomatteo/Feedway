export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
}

/**
 * Outgoing email. Until stage 3 configures SMTP from the panel, production uses an adapter
 * that drops the message and answers `not_configured`.
 */
export interface Mailer {
  isConfigured(): Promise<boolean>
  send(message: MailMessage): Promise<'sent' | 'not_configured'>
}

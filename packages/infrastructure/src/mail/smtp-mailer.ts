import type { Logger, Mailer, MailSettingsSource } from '@app/application'
import { SmtpSendError } from './smtp/smtp-error.js'
import type { SmtpSender } from './smtp/smtp-sender.js'

export interface SmtpMailerDeps {
  settings: MailSettingsSource
  smtp: SmtpSender
  logger: Logger
}

/**
 * Production mailer: reads the platform's SMTP settings at every send, so a change in the panel applies to
 * the next email with no restart. Without settings the message is dropped: `not_configured`.
 */
export function createSmtpMailer(deps: SmtpMailerDeps): Mailer {
  return {
    isConfigured: () => deps.settings.isConfigured(),
    async send(message) {
      const found = await deps.settings.credentials()
      if (found === null) return 'not_configured'
      try {
        await deps.smtp.send(found.config, found.secret, message)
      } catch (error) {
        // the kind and the server's reply (already without credentials or addresses)
        const failure =
          error instanceof SmtpSendError
            ? { kind: error.kind, response: error.response }
            : { kind: 'unexpected' }
        deps.logger.warn(failure, 'email not sent')
        throw error
      }
      deps.logger.info({}, 'email sent')
      return 'sent'
    },
  }
}

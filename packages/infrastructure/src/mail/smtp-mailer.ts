import type {
  IntegrationCredentialSource,
  IntegrationStore,
  Logger,
  Mailer,
} from '@app/application'
import { SmtpSendError } from './smtp/smtp-error.js'
import type { SmtpSender } from './smtp/smtp-sender.js'

export interface SmtpMailerDeps {
  integrations: Pick<IntegrationStore, 'get'> & IntegrationCredentialSource
  smtp: SmtpSender
  logger: Logger
}

/**
 * Production mailer: reads the SMTP settings at every send (the agency's own, else the
 * platform default), so a change in the panel applies to the next email with no restart.
 * Without settings the message is dropped: `not_configured`.
 */
export function createSmtpMailer(deps: SmtpMailerDeps): Mailer {
  return {
    async isConfigured(organizationId) {
      return (await deps.integrations.get(organizationId, 'smtp')) !== null
    },
    async send(message, sender) {
      const found = await deps.integrations.credentials(sender.organizationId, 'smtp')
      if (found === null) return 'not_configured'
      try {
        await deps.smtp.send(found.config, found.secret, message)
      } catch (error) {
        // the kind and the server's reply (already without credentials), never the recipient
        const failure =
          error instanceof SmtpSendError
            ? { kind: error.kind, response: error.response }
            : { kind: 'unexpected' }
        deps.logger.warn({ settings: found.owner, ...failure }, 'email not sent')
        throw error
      }
      deps.logger.info({ settings: found.owner }, 'email sent')
      return 'sent'
    },
  }
}

import type { Mailer } from '@app/application'

/** Production until stage 3: SMTP is not configured yet, so messages are dropped. */
export const notConfiguredMailer: Mailer = {
  isConfigured: () => Promise.resolve(false),
  send: () => Promise.resolve('not_configured'),
}

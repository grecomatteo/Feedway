import type { Mailer } from '@app/application'

/** Drops every message: for tests of the paths taken when no SMTP settings exist. */
export const notConfiguredMailer: Mailer = {
  isConfigured: () => Promise.resolve(false),
  send: () => Promise.resolve('not_configured'),
}

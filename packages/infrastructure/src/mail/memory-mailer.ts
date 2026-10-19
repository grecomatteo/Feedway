import type { Mailer, MailMessage } from '@app/application'

/** Keeps every message in memory, for unit and integration tests. */
export function createMemoryMailer(): Mailer & { readonly sent: readonly MailMessage[] } {
  const sent: MailMessage[] = []
  return {
    sent,
    isConfigured: () => Promise.resolve(true),
    send(message) {
      sent.push(message)
      return Promise.resolve('sent')
    },
  }
}

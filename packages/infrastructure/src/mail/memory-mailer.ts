import type { Mailer, MailMessage, MailSender } from '@app/application'

/** Keeps every message in memory, for unit and integration tests. */
export function createMemoryMailer(): Mailer & {
  readonly sent: readonly MailMessage[]
  /** Whose settings each message of `sent` left with, in the same order. */
  readonly senders: readonly MailSender[]
} {
  const sent: MailMessage[] = []
  const senders: MailSender[] = []
  return {
    sent,
    senders,
    isConfigured: () => Promise.resolve(true),
    send(message, sender) {
      sent.push(message)
      senders.push({ organizationId: sender.organizationId })
      return Promise.resolve('sent')
    },
  }
}

import { emailFrame, oneLine, renderEmail, type EmailBlock } from '../mail/index.js'
import { MailSendError, type Mailer, type MailFailureKind } from '../ports/mailer.js'
import type { NotificationChannel, RenderedMessage } from '../ports/notification-channel.js'
import type { Translate } from '../ports/translator.js'

// The email of the notifications (§12.3, ADR 017): the platform's SMTP, the layout of every
// transactional email, the button to the page where it is dealt with, and the way to change the
// notifications. Without SMTP the delivery is `skipped` with the reason.

export interface EmailChannelDeps {
  mailer: Mailer
  t: Translate
  productName: string
  panelUrl: URL
}

/** Failures that may pass on their own; the others need a person to change the settings. */
const TRANSIENT: ReadonlySet<MailFailureKind> = new Set(['dns', 'timeout', 'tls', 'connection'])

export function notificationEmail(
  deps: Pick<EmailChannelDeps, 't' | 'productName' | 'panelUrl'>,
  message: RenderedMessage,
): { subject: string; html: string; text: string } {
  const { t } = deps
  const blocks: EmailBlock[] = []
  if (message.context) blocks.push({ kind: 'paragraph', text: message.context, tone: 'muted' })
  // one line per notification, as a list: a paragraph with its line breaks
  const listed =
    message.more > 0
      ? [...message.lines, t('notify.more', { n: String(message.more) })]
      : message.lines
  if (listed.length > 0) blocks.push({ kind: 'paragraph', text: listed.join('\n') })
  // the digest: a bold heading per section and its lines below
  for (const section of message.sections ?? [])
    blocks.push({
      kind: 'list',
      title: section.title,
      items:
        section.more > 0
          ? [...section.lines, t('notify.more', { n: String(section.more) })]
          : section.lines,
    })
  if (message.link)
    blocks.push({
      kind: 'button',
      label: message.link.label,
      url: message.link.url,
      tone: 'primary',
    })
  blocks.push({
    kind: 'paragraph',
    text: t('notify.email.changeText', { url: new URL('account', deps.panelUrl).toString() }),
    tone: 'muted',
  })
  const { html, text } = renderEmail({
    ...emailFrame(t, deps.productName),
    preheader: message.lines[0] ?? message.sections?.[0]?.title ?? message.title,
    title: message.title,
    blocks,
    footerReason: t('notify.email.footer', { product: deps.productName }),
  })
  return { subject: oneLine(message.title), html, text }
}

export function createEmailChannel(deps: EmailChannelDeps): NotificationChannel {
  return {
    name: 'email',
    unavailable: deps.t('notify.skipped.email'),
    async isAvailable(_tx, recipient) {
      return recipient.email !== '' && (await deps.mailer.isConfigured())
    },
    async send(recipient, message) {
      try {
        const sent = await deps.mailer.send({
          to: recipient.email,
          ...notificationEmail(deps, message),
        })
        if (sent === 'not_configured')
          return { outcome: 'failed', error: deps.t('notify.skipped.email'), retry: false }
        return { outcome: 'sent' }
      } catch (error) {
        if (!(error instanceof MailSendError)) throw error
        return {
          outcome: 'failed',
          error: deps.t(`notify.errors.${error.kind}`),
          retry: TRANSIENT.has(error.kind),
        }
      }
    },
  }
}

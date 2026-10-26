import type { MailMessage } from '@app/application'

const ACTIVATION_LINK = /https?:\/\/[^\s"<>]+\/attiva\/([^\s"<>]+)/

/**
 * The activation link of the last message sent to `to` (invites arrive only by email), with its
 * token as the link routes take it. Fails when that mailbox got no link.
 */
export function activationLinkIn(
  messages: readonly MailMessage[],
  to: string,
): { url: string; token: string } {
  const message = messages.filter((m) => m.to === to).at(-1)
  const match = message === undefined ? null : ACTIVATION_LINK.exec(message.text)
  if (match === null) throw new Error(`no activation link sent to ${to}`)
  return { url: match[0], token: decodeURIComponent(match[1] ?? '') }
}

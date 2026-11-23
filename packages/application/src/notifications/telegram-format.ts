// Telegram's HTML formatting (parse_mode HTML, plan 08 Task 7): every text the bot sends is built
// here, from text escaped once and a few tags. Telegram refuses the whole message for one bad
// `<` or an unclosed tag, so nothing reaches a message without `escapeHtml`.

/** Telegram's limit for a message's text. */
export const TELEGRAM_TEXT_MAX = 4096

/** A piece of a message already safe for parse_mode HTML. */
export type TelegramHtml = string & { readonly __telegramHtml: true }

const html = (s: string) => s as TelegramHtml

export function escapeHtml(text: string): TelegramHtml {
  return html(text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
}

export const plain = escapeHtml

export const bold = (text: string): TelegramHtml => html(`<b>${escapeHtml(text)}</b>`)

export const italic = (text: string): TelegramHtml => html(`<i>${escapeHtml(text)}</i>`)

export function link(url: string, label: string): TelegramHtml {
  const href = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return html(`<a href="${href}">${escapeHtml(label)}</a>`)
}

/** Joins safe pieces: what is not already safe cannot be passed. */
export const joinHtml = (parts: readonly TelegramHtml[], separator = '\n'): TelegramHtml =>
  html(parts.join(separator))

/** A text cut at a word, with «…», for a line that must stay short. */
export function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

export interface TelegramSection {
  /** The agency's name, when there are more */
  title?: TelegramHtml
  lines: readonly TelegramHtml[]
  /** Lines already left out before (counted in «e altri N») */
  hidden?: number
  /** After the lines: the section's link */
  footer?: TelegramHtml
  /** A blank line between lines of more than one row (the posts of `/oggi`) */
  spaced?: boolean
}

/**
 * A message of sections, within Telegram's limit: the head, each title and footer and the tail
 * always stay; lines are dropped whole (a tag is never cut) from the section that has most, and
 * `more(n)` says how many are left out.
 */
export function fitMessage(input: {
  head: readonly TelegramHtml[]
  sections: readonly TelegramSection[]
  tail?: readonly TelegramHtml[]
  more: (n: number) => TelegramHtml
}): TelegramHtml {
  const kept = input.sections.map((s) => s.lines.length)
  const build = () =>
    joinHtml(
      [
        ...input.head,
        ...input.sections.map((section, i) => {
          const shown = section.lines.slice(0, kept[i])
          const left = (section.hidden ?? 0) + section.lines.length - shown.length
          return joinHtml(
            [
              ...(section.title ? [section.title] : []),
              joinHtml(shown, section.spaced === true ? '\n\n' : '\n'),
              ...(left > 0 ? [input.more(left)] : []),
              ...(section.footer ? [html(`\n${section.footer}`)] : []),
            ].filter((p) => p !== ''),
          )
        }),
        ...(input.tail ?? []),
      ].filter((p) => p !== ''),
      '\n\n',
    )
  let text = build()
  while (text.length > TELEGRAM_TEXT_MAX) {
    const most = kept.reduce((best, n, i) => (n > (kept[best] ?? 0) ? i : best), 0)
    if ((kept[most] ?? 0) === 0) break
    kept[most] = (kept[most] ?? 0) - 1
    text = build()
  }
  return text
}

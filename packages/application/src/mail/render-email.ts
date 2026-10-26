/**
 * The one layout of every transactional email (DESIGN.md, "Email transazionali"): a 600 px
 * column of tables with inline styles, light only, the logo as the only image, no tracking.
 * Values arrive as plain text and are escaped here; the plain-text version follows the canvas.
 */

export type EmailBlock =
  /** `muted` is the 14/20 grey note ("Non conosci…", "Il link funziona per 7 giorni."). */
  | { kind: 'paragraph'; text: string; tone?: 'muted' }
  /** A bold line of its own ("Sei stato tu?") and its text below. */
  | { kind: 'lead'; lead: string; text: string }
  | { kind: 'button'; label: string; url: string; tone: 'primary' | 'danger' }
  | { kind: 'box'; title: string; text: string }
  | { kind: 'details'; rows: readonly { label: string; value: string }[] }

export interface EmailContent {
  preheader: string
  title: string
  blocks: readonly EmailBlock[]
  /** Why this person gets this email, specific to it. */
  footerReason: string
  productName: string
  logoUrl: string
  /** Texts shared by every email, from it.json. */
  chrome: { buttonFallback: string; serviceNotice: string }
}

const C = {
  page: '#FAF9F6',
  card: '#FFFFFF',
  line: '#E3DFD7',
  text: '#242321',
  muted: '#5F5B55',
  box: '#F3F1EC',
  primary: '#FF762E',
  danger: '#B3261E',
  onDanger: '#FFFFFF',
}
const BODY_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const TITLE_FONT = `Sora, ${BODY_FONT}`

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c)
/** Escaped, with line breaks kept. */
const html = (value: string) => escapeHtml(value).replace(/\r?\n/g, '<br>')

/** Only web addresses: anything else (javascript:, data:…) is a bug, not something to send. */
function webLink(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('email link is not an absolute web address')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error('email link must be http or https')
  return value
}

const font = (family: string, size: number, lineHeight: number, color: string, weight = 400) =>
  `margin:0;font-family:${family};font-size:${String(size)}px;line-height:${String(lineHeight)}px;font-weight:${String(weight)};color:${color};`

const p = (text: string, style: string) => `<p style="${style}">${html(text)}</p>`
const body16 = font(BODY_FONT, 16, 24, C.text)
const note14 = font(BODY_FONT, 14, 20, C.muted)

const presentation = 'role="presentation" border="0" cellpadding="0" cellspacing="0"'

function box(inner: string): string {
  return `<table ${presentation} width="100%" style="width:100%;border-collapse:separate;"><tr><td bgcolor="${C.box}" style="background-color:${C.box};border:1px solid ${C.line};border-radius:8px;padding:16px 20px;">${inner}</td></tr></table>`
}

function button(block: Extract<EmailBlock, { kind: 'button' }>, fallback: string): string {
  const url = escapeHtml(webLink(block.url))
  const fill = block.tone === 'danger' ? C.danger : C.primary
  const ink = block.tone === 'danger' ? C.onDanger : C.text
  const cell = `<table ${presentation} class="email-btn" style="border-collapse:separate;"><tr><td align="center" bgcolor="${fill}" style="background-color:${fill};border:2px solid ${C.text};border-radius:8px;"><a href="${url}" target="_blank" rel="noopener" style="display:block;padding:12px 28px;font-family:${BODY_FONT};font-size:16px;line-height:20px;font-weight:600;color:${ink};text-decoration:none;border-radius:6px;">${html(block.label)}</a></td></tr></table>`
  const clear = `<p style="${note14}padding-top:16px;">${html(fallback)}<br><span style="color:${C.text};text-decoration:underline;word-break:break-all;">${url}</span></p>`
  return cell + clear
}

function blockHtml(block: EmailBlock, chrome: EmailContent['chrome']): string {
  switch (block.kind) {
    case 'paragraph':
      return p(block.text, block.tone === 'muted' ? note14 : body16)
    case 'lead':
      return p(block.lead, font(BODY_FONT, 16, 24, C.text, 600)) + p(block.text, body16)
    case 'button':
      return button(block, chrome.buttonFallback)
    case 'box':
      return box(
        p(block.title, font(BODY_FONT, 15, 21, C.text, 600)) +
          p(block.text, `${font(BODY_FONT, 15, 22, C.text)}padding-top:6px;`),
      )
    case 'details':
      return box(
        block.rows
          .map(
            (row, i) =>
              p(
                row.label,
                `${font(BODY_FONT, 13, 18, C.muted, 600)}${i > 0 ? 'padding-top:12px;' : ''}`,
              ) + p(row.value, font(BODY_FONT, 16, 23, C.text)),
          )
          .join(''),
      )
  }
}

/** "Puoi usarlo fino a…" → "puoi usarlo fino a…", after the box title and a colon. */
const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase('it-IT') + text.slice(1)

function blockText(block: EmailBlock): string {
  switch (block.kind) {
    case 'paragraph':
      return block.text
    case 'lead':
      return `${block.lead} ${block.text}`
    case 'button':
      return `${block.label}:\n${block.url}`
    case 'box':
      return `${block.title}: ${lowerFirst(block.text)}`
    case 'details':
      return block.rows.map((row) => `${row.label}: ${row.value}`).join('\n')
  }
}

const STYLE = `<style>
body{margin:0;padding:0;}
@media (max-width:480px){
.email-outer{padding:16px 12px 24px !important;}
.email-pad{padding-left:20px !important;padding-right:20px !important;}
.email-head{padding-top:24px !important;}
.email-body{padding-bottom:32px !important;}
.email-title{font-size:22px !important;line-height:29px !important;}
.email-btn{width:100% !important;}
.email-btn a{padding-left:12px !important;padding-right:12px !important;}
}
</style>`

/** Keeps the start of the body out of the inbox preview, after the preheader. */
const PREVIEW_FILLER = '&#847;&zwnj;&nbsp;'.repeat(40)

export function renderEmail(content: EmailContent): { html: string; text: string } {
  const logo = escapeHtml(webLink(content.logoUrl))
  const product = escapeHtml(content.productName)
  const blocks = content.blocks
    .map(
      (block, i) =>
        `<tr><td style="${i > 0 ? 'padding-top:20px;' : ''}">${blockHtml(block, content.chrome)}</td></tr>`,
    )
    .join('')
  const footer =
    p(content.productName, font(BODY_FONT, 13, 20, C.muted, 600)) +
    p(content.footerReason, `${font(BODY_FONT, 13, 20, C.muted)}padding-top:6px;`) +
    p(content.chrome.serviceNotice, `${font(BODY_FONT, 13, 20, C.muted)}padding-top:6px;`)

  const page = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(content.title)}</title>
${STYLE}
</head>
<body bgcolor="${C.page}" style="margin:0;padding:0;background-color:${C.page};color:${C.text};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};">${html(content.preheader)}${PREVIEW_FILLER}</div>
<table ${presentation} width="100%" bgcolor="${C.page}" style="width:100%;background-color:${C.page};"><tr><td align="center" class="email-outer" style="padding:32px 12px 40px;">
<table ${presentation} width="100%" style="width:100%;max-width:600px;">
<tr><td bgcolor="${C.card}" style="background-color:${C.card};border:1px solid ${C.line};border-radius:12px;">
<table ${presentation} width="100%" style="width:100%;">
<tr><td class="email-pad email-head" style="padding:32px 40px 8px;"><img src="${logo}" alt="${product}" width="176" height="51" style="display:block;width:176px;height:51px;border:0;outline:none;text-decoration:none;background-color:${C.card};color:${C.text};font-family:${BODY_FONT};font-size:16px;"></td></tr>
<tr><td class="email-pad email-body" style="padding:24px 40px 40px;">
<h1 class="email-title" style="${font(TITLE_FONT, 24, 31, C.text, 650)}padding-bottom:20px;">${html(content.title)}</h1>
<table ${presentation} width="100%" style="width:100%;">${blocks}</table>
</td></tr>
</table>
</td></tr>
<tr><td class="email-pad" style="padding:24px 40px 0;">${footer}</td></tr>
</table>
</td></tr></table>
</body>
</html>`

  const text = [
    content.title,
    ...content.blocks.map(blockText),
    ['--', content.productName, content.footerReason, content.chrome.serviceNotice].join('\n'),
  ].join('\n\n')
  return { html: page, text }
}

/** One line: no header can be slipped into a subject through a name. */
export const oneLine = (text: string) => text.replace(/\p{Cc}+/gu, ' ')

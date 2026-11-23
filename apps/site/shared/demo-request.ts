/**
 * The «Richiedi una demo» form (ADR 016): the checks shared by the page and the Cloudflare function,
 * and the email the function sends. Nothing here is stored.
 */

/** A person needs at least this long to fill the form; a faster send is a bot. */
export const MIN_FILL_MS = 3_000

export const LIMITS = {
  name: 120,
  agency: 120,
  email: 254,
  phone: 40,
  clients: 40,
  message: 3000,
} as const

export type DemoField = keyof typeof LIMITS
export type DemoRequest = Record<DemoField, string>
export type FieldError = 'required' | 'email' | 'tooLong'

export type ParseResult =
  | { ok: true; request: DemoRequest }
  | { ok: false; reason: 'invalid'; errors: Partial<Record<DemoField, FieldError>> }
  | { ok: false; reason: 'spam' }

const REQUIRED: readonly DemoField[] = ['name', 'agency', 'email']
const SINGLE_LINE: readonly DemoField[] = ['name', 'agency', 'email', 'phone', 'clients']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseDemoRequest(input: Record<string, unknown>, now: number): ParseResult {
  // `website` is a field people never see; `startedAt` is written by the page when it opens
  if (str(input.website) !== '') return { ok: false, reason: 'spam' }
  const startedAt = Number(str(input.startedAt))
  if (!Number.isFinite(startedAt) || startedAt <= 0 || now - startedAt < MIN_FILL_MS) {
    return { ok: false, reason: 'spam' }
  }

  const request = {} as DemoRequest
  const errors: Partial<Record<DemoField, FieldError>> = {}
  for (const field of Object.keys(LIMITS) as DemoField[]) {
    const raw = str(input[field])
    const value = SINGLE_LINE.includes(field) ? raw.trim() : raw.replace(/\r\n?/g, '\n').trim()
    request[field] = value
    if (value === '') {
      if (REQUIRED.includes(field)) errors[field] = 'required'
    } else if (field === 'email' && (/[\r\n]/.test(value) || !EMAIL.test(value))) {
      errors[field] = 'email'
    } else if (value.length > LIMITS[field]) {
      errors[field] = 'tooLong'
    } else if (SINGLE_LINE.includes(field) && /[\r\n]/.test(value)) {
      errors[field] = 'tooLong'
    }
  }
  return Object.keys(errors).length > 0
    ? { ok: false, reason: 'invalid', errors }
    : { ok: true, request }
}

export interface EmailEnvelope {
  from: string
  to: string
  date: Date
  messageId: string
}

/** A raw RFC 5322 message, plain text in UTF-8, ready for Cloudflare's `EmailMessage`. */
export function buildDemoEmail(r: DemoRequest, env: EmailEnvelope): string {
  const body = [
    'Nuova richiesta di demo dal sito.',
    '',
    `Nome: ${r.name}`,
    `Agenzia: ${r.agency}`,
    `Email: ${r.email}`,
    `Telefono: ${r.phone || '—'}`,
    `Clienti gestiti: ${r.clients || '—'}`,
    '',
    'Messaggio:',
    r.message || '—',
    '',
    'Rispondi a questa email per scrivere direttamente a chi ha chiesto la demo.',
  ].join('\n')
  const headers = [
    `From: Feedway <${env.from}>`,
    `To: ${env.to}`,
    `Reply-To: ${r.email}`,
    `Subject: ${encodeWord(`Richiesta di demo: ${r.agency}`)}`,
    `Date: ${env.date.toUTCString()}`,
    `Message-ID: ${env.messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ]
  return `${headers.join('\r\n')}\r\n\r\n${wrap(toBase64(body))}\r\n`
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function toBase64(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function encodeWord(text: string): string {
  return `=?utf-8?B?${toBase64(text)}?=`
}

function wrap(b64: string): string {
  return b64.match(/.{1,76}/g)?.join('\r\n') ?? ''
}

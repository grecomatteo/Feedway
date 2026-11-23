import { expect, test } from 'vitest'
import { MailSendError, type Mailer, type MailMessage } from '../ports/mailer.js'
import type { RenderedMessage } from '../ports/notification-channel.js'
import type { Tx } from '../ports/tx.js'
import { createEmailChannel } from './email-channel.js'

// The key and its values, so the test sees what the channel asks for.
const t = (key: string, values: Readonly<Record<string, string>> = {}) =>
  Object.keys(values).length === 0 ? key : `${key} ${JSON.stringify(values)}`

const message: RenderedMessage = {
  level: 'error',
  title: '3 pubblicazioni non sono uscite',
  context: 'Agenzia Luce · Forno Luce',
  lines: ['Forno Luce · «Pane caldo»: un errore di Instagram'],
  more: 2,
  link: { label: 'Apri i post', url: 'https://pannello.example.test/luce/spazi/forno/post' },
}

const recipient = { userId: 'u', organizationId: 'o', email: 'ada@example.test', name: 'Ada' }
const tx = {} as Tx

function mailer(answer: () => Promise<'sent' | 'not_configured'>, configured = true) {
  const sent: MailMessage[] = []
  const m: Mailer = {
    isConfigured: () => Promise.resolve(configured),
    send: (msg) => {
      sent.push(msg)
      return answer()
    },
  }
  return { m, sent }
}

const channel = (m: Mailer) =>
  createEmailChannel({
    mailer: m,
    t,
    productName: 'Feedway',
    panelUrl: new URL('https://pannello.example.test/'),
  })

test('the email has the title as subject, the lines, «e altre N», the button and the way to change', async () => {
  const { m, sent } = mailer(() => Promise.resolve('sent'))
  const signal = new AbortController().signal
  expect(await channel(m).send(recipient, message, signal)).toEqual({ outcome: 'sent' })
  const [email] = sent
  expect(email?.to).toBe('ada@example.test')
  expect(email?.subject).toBe('3 pubblicazioni non sono uscite')
  expect(email?.text).toContain('Agenzia Luce · Forno Luce')
  expect(email?.text).toContain('Forno Luce · «Pane caldo»: un errore di Instagram')
  expect(email?.text).toContain('notify.more {"n":"2"}')
  expect(email?.text).toContain('https://pannello.example.test/luce/spazi/forno/post')
  expect(email?.text).toContain('https://pannello.example.test/account')
  expect(email?.html).toContain('Apri i post')
})

test('without SMTP or an address the channel is not available', async () => {
  expect(
    await channel(mailer(() => Promise.resolve('sent'), false).m).isAvailable(tx, recipient),
  ).toBe(false)
  const ok = channel(mailer(() => Promise.resolve('sent')).m)
  expect(await ok.isAvailable(tx, recipient)).toBe(true)
  expect(await ok.isAvailable(tx, { ...recipient, email: '' })).toBe(false)
  expect(ok.unavailable).toBe('notify.skipped.email')
})

test('a failure that may pass is retried, one that needs a person is not', async () => {
  const signal = new AbortController().signal
  const failing = (kind: 'timeout' | 'auth') =>
    channel(mailer(() => Promise.reject(new MailSendError(kind, 'secret reply'))).m).send(
      recipient,
      message,
      signal,
    )
  expect(await failing('timeout')).toEqual({
    outcome: 'failed',
    error: 'notify.errors.timeout',
    retry: true,
  })
  // the server's reply never reaches the row: only the translated kind
  expect(await failing('auth')).toEqual({
    outcome: 'failed',
    error: 'notify.errors.auth',
    retry: false,
  })
})

test('the digest has a heading per section, its lines and «e altre N»', async () => {
  const { m, sent } = mailer(() => Promise.resolve('sent'))
  const digest: RenderedMessage = {
    level: 'info',
    title: 'Il riepilogo di lunedì 23 novembre',
    context: 'Agenzia Luce',
    lines: [],
    more: 0,
    link: null,
    sections: [
      { title: 'Ieri sono usciti 2 post', lines: ['Forno Luce · «Pane caldo»'], more: 0 },
      { title: 'Da sistemare', lines: ['Forno Luce · «Torta»: non è uscito'], more: 3 },
    ],
  }
  await channel(m).send(recipient, digest, new AbortController().signal)
  const [email] = sent
  expect(email?.text).toMatch(/Ieri sono usciti 2 post[\s\S]*«Pane caldo»[\s\S]*Da sistemare/)
  expect(email?.text).toContain('notify.more {"n":"3"}')
  expect(email?.html).toContain('Da sistemare')
})

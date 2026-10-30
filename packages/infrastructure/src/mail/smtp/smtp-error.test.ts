import { expect, test } from 'vitest'
import { safeResponse, SmtpSendError } from './smtp-error.js'

const credentials = { username: 'invii@feedway.test', secret: 'parola-di-prova-giusta' }
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

test('the username and the secret go, in clear and in base64', () => {
  const plain = b64(`\u0000${credentials.username}\u0000${credentials.secret}`)
  const reply = [
    `535 AUTH ${plain} rejected`,
    `user ${b64(credentials.username)} pass ${b64(credentials.secret).replace(/=+$/, '')}`,
    `echo ${credentials.secret}`,
  ].join('\r\n')
  const out = safeResponse(reply, credentials)
  for (const leak of [
    plain,
    b64(credentials.username),
    b64(credentials.secret).replace(/=+$/, ''),
    credentials.secret,
    credentials.username,
  ])
    expect(out).not.toContain(leak)
  expect(out).toContain('[REDACTED]')
})

test('email addresses go, the reply stays on one line and is cut short', () => {
  const out = safeResponse(
    `550 5.1.1 <persona@esempio.test>: utente sconosciuto\r\nda avvisi@feedway.test\t${'x'.repeat(300)}`,
    credentials,
  )
  expect(out).not.toMatch(/@/)
  expect(out).toContain('[email]')
  expect(out).not.toMatch(/[\r\n\t]/)
  expect(out.length).toBeLessThanOrEqual(201)
})

test('the error message carries only the kind and the cleaned reply', () => {
  const error = new SmtpSendError('rejected', safeResponse('550 no <a@b.test>', credentials))
  expect(error.message).toBe('smtp rejected: 550 no <[email]>')
})

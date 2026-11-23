import { describe, expect, it } from 'vitest'
import { buildDemoEmail, MIN_FILL_MS, parseDemoRequest } from './demo-request.ts'

const now = 1_800_000_000_000
const valid = {
  name: 'Paola Rossi',
  agency: 'Studio Aurora',
  email: 'paola@example.com',
  startedAt: String(now - 20_000),
}

describe('parseDemoRequest', () => {
  it('accepts the three required fields and trims them', () => {
    const r = parseDemoRequest({ ...valid, name: '  Paola Rossi ' }, now)
    expect(r).toEqual({
      ok: true,
      request: {
        name: 'Paola Rossi',
        agency: 'Studio Aurora',
        email: 'paola@example.com',
        phone: '',
        clients: '',
        message: '',
      },
    })
  })

  it('names every missing or wrong field', () => {
    const r = parseDemoRequest(
      { name: ' ', agency: '', email: 'paola', startedAt: valid.startedAt },
      now,
    )
    expect(r).toEqual({
      ok: false,
      reason: 'invalid',
      errors: { name: 'required', agency: 'required', email: 'email' },
    })
  })

  it('refuses a filled honeypot or a form sent too fast, without saying why', () => {
    expect(parseDemoRequest({ ...valid, website: 'x' }, now)).toEqual({ ok: false, reason: 'spam' })
    expect(parseDemoRequest({ ...valid, startedAt: String(now - MIN_FILL_MS + 1) }, now)).toEqual({
      ok: false,
      reason: 'spam',
    })
    expect(parseDemoRequest({ ...valid, startedAt: 'abc' }, now)).toEqual({
      ok: false,
      reason: 'spam',
    })
  })

  it('limits the lengths and refuses line breaks in single-line fields', () => {
    const r = parseDemoRequest(
      { ...valid, name: 'a'.repeat(121), email: 'a@b.it\r\nBcc: x@y.z', message: 'm'.repeat(3001) },
      now,
    )
    expect(r).toEqual({
      ok: false,
      reason: 'invalid',
      errors: { name: 'tooLong', email: 'email', message: 'tooLong' },
    })
  })
})

describe('buildDemoEmail', () => {
  it('writes a plain-text email with the requester as Reply-To', () => {
    const raw = buildDemoEmail(
      {
        name: 'Paola Rossi',
        agency: 'Studio «Aurora»',
        email: 'paola@example.com',
        phone: '',
        clients: '12',
        message: 'Ciao\na presto',
      },
      {
        from: 'demo@feedway.it',
        to: 'matteo@example.org',
        date: new Date(now),
        messageId: '<1@feedway.it>',
      },
    )
    expect(raw).toContain('From: Feedway <demo@feedway.it>\r\n')
    expect(raw).toContain('To: matteo@example.org\r\n')
    expect(raw).toContain('Reply-To: paola@example.com\r\n')
    expect(raw).toContain('Content-Type: text/plain; charset=utf-8\r\n')
    expect(raw).toMatch(/Subject: =\?utf-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/)
    const body = Buffer.from(
      (raw.split('\r\n\r\n')[1] ?? '').replace(/\r\n/g, ''),
      'base64',
    ).toString('utf8')
    expect(body).toContain('Agenzia: Studio «Aurora»')
    expect(body).toContain('Clienti gestiti: 12')
    expect(body).toContain('Telefono: —')
    expect(body).toContain('Ciao\na presto')
  })
})

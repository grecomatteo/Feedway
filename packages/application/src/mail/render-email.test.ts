import { describe, expect, test } from 'vitest'
import { renderEmail, type EmailContent } from './render-email.js'

const base: EmailContent = {
  preheader: 'Crea il tuo account per entrare.',
  title: 'Giulia ti ha invitato in Studio Riva',
  blocks: [
    { kind: 'paragraph', text: 'Studio Riva usa Feedway.' },
    {
      kind: 'button',
      label: 'Crea il tuo account',
      url: 'https://pannello.example.test/attiva?t=a&b=c',
      tone: 'primary',
    },
    { kind: 'box', title: 'L’invito scade tra 72 ore', text: 'Puoi usarlo fino a giovedì.' },
    { kind: 'paragraph', text: 'Non conosci Studio Riva? Ignora questa email.', tone: 'muted' },
  ],
  footerReason: 'Ricevi questa email perché Giulia ti ha invitato.',
  productName: 'Feedway',
  logoUrl: 'https://pannello.example.test/email/feedway-logo@2x.png',
  chrome: {
    buttonFallback: 'Se il pulsante non funziona, copia questo indirizzo nel browser:',
    serviceNotice: 'È un messaggio di servizio: lo inviamo solo quando serve al tuo account.',
  },
}

describe('html', () => {
  test('the info box of E5 is blue with a blue border; the plain box stays neutral', () => {
    const { html } = renderEmail({
      ...base,
      blocks: [{ kind: 'box', title: 'Abbiamo avvisato', text: 'Anche il vecchio.', tone: 'info' }],
    })
    expect(html).toContain('background-color:#E7EFFA;border:1px solid #1F5AA6;')
    expect(renderEmail(base).html).not.toContain('#E7EFFA')
  })

  test('a light-only page for email clients, at most 600 px wide, with the hidden preheader first', () => {
    const { html } = renderEmail(base)
    expect(html).toMatch(/^<!doctype html>/i)
    expect(html).toContain('<meta name="color-scheme" content="light">')
    expect(html).toContain('<meta name="supported-color-schemes" content="light">')
    expect(html).toContain('max-width:600px')
    expect(html.match(/<style/g)).toHaveLength(1)
    expect(html).toContain('@media (max-width:480px)')
    const body = html.slice(html.indexOf('<body'))
    expect(body.indexOf('Crea il tuo account per entrare.')).toBeLessThan(
      body.indexOf('Studio Riva usa Feedway.'),
    )
    expect(body).toMatch(/<div[^>]*display:none[^>]*>Crea il tuo account per entrare\./)
  })

  test('the only image is the logo, 176×51, named after the product, with no link around it', () => {
    const { html } = renderEmail(base)
    const images = html.match(/<img\b[^>]*>/g) ?? []
    expect(images).toHaveLength(1)
    expect(images[0]).toContain('src="https://pannello.example.test/email/feedway-logo@2x.png"')
    expect(images[0]).toContain('alt="Feedway"')
    expect(images[0]).toContain('width="176"')
    expect(images[0]).toContain('height="51"')
    expect(html).not.toMatch(/<a\b[^>]*>\s*<img/)
  })

  test('no tracking: no utm parameters, no unsubscribe, links only to the button address', () => {
    const { html } = renderEmail(base)
    expect(html).not.toMatch(/utm_/i)
    expect(html).not.toMatch(/unsubscribe|disiscri/i)
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])
    expect(new Set(hrefs)).toEqual(new Set(['https://pannello.example.test/attiva?t=a&amp;b=c']))
  })

  test('the button is a coloured cell with a link, followed by the address in clear', () => {
    const { html } = renderEmail(base)
    expect(html).toMatch(/bgcolor="#FF762E"[^>]*>\s*<a href="https:\/\/pannello/)
    expect(html).toContain('Se il pulsante non funziona, copia questo indirizzo nel browser:')
    expect(html).toMatch(
      /word-break:break-all[^>]*>https:\/\/pannello\.example\.test\/attiva\?t=a&amp;b=c</,
    )
  })

  test('the danger button is red with white text', () => {
    const { html } = renderEmail({
      ...base,
      blocks: [{ kind: 'button', label: 'Blocca', url: 'https://x.test/b', tone: 'danger' }],
    })
    expect(html).toContain('bgcolor="#B3261E"')
    expect(html).toMatch(/color:#FFFFFF[^>]*>Blocca</)
  })

  test('every text has a colour and the footer sits outside the card', () => {
    const { html } = renderEmail(base)
    for (const tag of html.match(/<(p|h1)\b[^>]*>/g) ?? []) expect(tag).toMatch(/color:#/)
    const card = html.indexOf('background-color:#FFFFFF')
    expect(html.indexOf('Ricevi questa email perché')).toBeGreaterThan(
      html.indexOf('Ignora questa email'),
    )
    expect(card).toBeGreaterThan(-1)
  })
})

describe('escaping', () => {
  const hostile = '<script>alert(1)</script> "Riva" & l\'altra'

  test('names with markup and quotes are escaped everywhere, attributes included', () => {
    const { html, text } = renderEmail({
      ...base,
      preheader: hostile,
      title: hostile,
      productName: hostile,
      footerReason: hostile,
      blocks: [
        { kind: 'paragraph', text: hostile },
        { kind: 'lead', lead: hostile, text: hostile },
        { kind: 'box', title: hostile, text: hostile },
        { kind: 'details', rows: [{ label: hostile, value: hostile }] },
      ],
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('"Riva"')
    expect(html).not.toContain("l'altra")
    expect(html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt; &quot;Riva&quot; &amp; l&#39;altra',
    )
    expect(html).toContain('alt="&lt;script&gt;')
    // the plain text is not markup: it keeps the value as it is
    expect(text).toContain(hostile)
  })

  test('quotes in a link cannot leave the attribute', () => {
    const url = 'https://x.test/a?n="><script>alert(1)</script>&q=\'x'
    const { html } = renderEmail({
      ...base,
      blocks: [{ kind: 'button', label: 'Vai', url, tone: 'primary' }],
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toMatch(/href="[^"]*"[^>]*><script/)
    expect(html).toContain('href="https://x.test/a?n=&quot;&gt;&lt;script&gt;')
  })

  test.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,x',
    'ftp://x.test',
    'not a url',
  ])('a link to %s is refused', (url) => {
    expect(() =>
      renderEmail({ ...base, blocks: [{ kind: 'button', label: 'Vai', url, tone: 'primary' }] }),
    ).toThrow(/link/)
  })

  test('the logo address follows the same rule', () => {
    expect(() => renderEmail({ ...base, logoUrl: 'javascript:alert(1)' })).toThrow(/link/)
  })
})

describe('plain text', () => {
  test('title, paragraphs, "Label:" and the address, the box in one sentence, then the footer', () => {
    const { text } = renderEmail(base)
    expect(text).toBe(
      [
        'Giulia ti ha invitato in Studio Riva',
        'Studio Riva usa Feedway.',
        'Crea il tuo account:\nhttps://pannello.example.test/attiva?t=a&b=c',
        'L’invito scade tra 72 ore: puoi usarlo fino a giovedì.',
        'Non conosci Studio Riva? Ignora questa email.',
        '--\nFeedway\nRicevi questa email perché Giulia ti ha invitato.\nÈ un messaggio di servizio: lo inviamo solo quando serve al tuo account.',
      ].join('\n\n'),
    )
  })

  test('a lead and its text share a line, details are "Label: value" lines', () => {
    const { text, html } = renderEmail({
      ...base,
      blocks: [
        {
          kind: 'details',
          rows: [
            { label: 'Quando', value: 'lunedì' },
            { label: 'Dispositivo', value: 'Chrome su Windows' },
          ],
        },
        { kind: 'lead', lead: 'Sei stato tu?', text: 'Non devi fare nulla.' },
      ],
    })
    expect(text).toContain(
      'Quando: lunedì\nDispositivo: Chrome su Windows\n\nSei stato tu? Non devi fare nulla.',
    )
    expect(html).toMatch(/font-weight:600[^>]*>Sei stato tu\?<\/p>/)
  })
})

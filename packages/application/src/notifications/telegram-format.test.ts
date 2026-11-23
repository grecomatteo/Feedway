import { expect, test } from 'vitest'
import { telegramText } from './telegram-channel.js'
import {
  TELEGRAM_TEXT_MAX,
  bold,
  escapeHtml,
  fitMessage,
  italic,
  link,
  plain,
  shorten,
} from './telegram-format.js'

const t = (key: string, params?: Record<string, string>) =>
  params ? `${key}(${Object.values(params).join(',')})` : key

test('text from people is escaped once, tags and links are safe', () => {
  expect(escapeHtml('<b>Bar & Co</b>')).toBe('&lt;b&gt;Bar &amp; Co&lt;/b&gt;')
  expect(bold('A < B')).toBe('<b>A &lt; B</b>')
  expect(italic('«x»')).toBe('<i>«x»</i>')
  expect(link('https://x.it/?a=1&b="2"', 'Apri <qui>')).toBe(
    '<a href="https://x.it/?a=1&amp;b=&quot;2&quot;">Apri &lt;qui&gt;</a>',
  )
})

test('a long text is cut at a word', () => {
  expect(shorten('uno  due\ntre', 20)).toBe('uno due tre')
  expect(shorten('Una frase piuttosto lunga da tagliare', 20)).toBe('Una frase piuttosto…')
})

test('a notification: bold title with its mark, context, lines, the link last', () => {
  const text = telegramText(t, {
    level: 'error',
    title: '2 post non sono usciti',
    context: 'Alfa · Bar <Roma>',
    lines: ['Instagram, 9:30', 'Facebook, 10:00'],
    more: 1,
    link: { label: 'Apri l’esito', url: 'https://feedway.test/alfa/post/1' },
  })
  expect(text).toBe(
    [
      '<b>❌ 2 post non sono usciti</b>\n<i>Alfa · Bar &lt;Roma&gt;</i>',
      '• Instagram, 9:30\n• Facebook, 10:00\n<i>notify.more(1)</i>',
      '<a href="https://feedway.test/alfa/post/1">Apri l’esito →</a>',
    ].join('\n\n'),
  )
})

test('too long for Telegram: whole lines go, the head and the link stay, and it says how many', () => {
  const lines = Array.from({ length: 60 }, (_, i) => `riga ${String(i)} ${'x'.repeat(100)}`)
  const text = telegramText(t, {
    level: 'warning',
    title: 'Molte cose',
    context: null,
    lines,
    more: 0,
    link: { label: 'Apri', url: 'https://feedway.test/' },
  })
  expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_MAX)
  expect(text.startsWith('<b>⚠️ Molte cose</b>')).toBe(true)
  expect(text.endsWith('<a href="https://feedway.test/">Apri →</a>')).toBe(true)
  const shown = text.split('\n').filter((l) => l.startsWith('• riga')).length
  expect(text).toContain(`<i>notify.more(${String(60 - shown)})</i>`)
})

test('sections share the room: the one with most lines gives them up first', () => {
  const long = (n: number) => Array.from({ length: n }, () => plain('y'.repeat(300)))
  const text = fitMessage({
    head: [bold('Oggi')],
    sections: [
      { title: bold('A'), lines: long(20), footer: link('https://a.test/', 'A') },
      { title: bold('B'), lines: long(2), footer: link('https://b.test/', 'B') },
    ],
    more: (n) => italic(`e altri ${String(n)}`),
  })
  expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_MAX)
  expect(text).toContain('<a href="https://a.test/">A</a>')
  expect(text).toContain('<a href="https://b.test/">B</a>')
  // B keeps its two lines; A says how many it left out
  const [, b = ''] = text.split('<b>B</b>')
  expect(b.match(/y{300}/g)).toHaveLength(2)
  expect(text).toMatch(/<i>e altri \d+<\/i>/)
})

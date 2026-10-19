import { expect, test } from 'vitest'
import { createTranslate, loadItalianMessages } from './i18n.js'

const t = createTranslate({ a: { b: 'Ciao {name}, da {product}.' } })

test('fills placeholders from nested keys', () => {
  expect(t('a.b', { name: 'Anna', product: 'Feedway' })).toBe('Ciao Anna, da Feedway.')
})

test('a missing key or value throws instead of sending a gap', () => {
  expect(() => t('a.c')).toThrow(/a\.c/)
  expect(() => t('a.b', { name: 'Anna' })).toThrow(/product/)
})

test('values are inserted as they are, never read as placeholders', () => {
  expect(t('a.b', { name: '{product}', product: 'X' })).toBe('Ciao {product}, da X.')
})

test('the panel texts load from the sources', () => {
  expect(createTranslate(loadItalianMessages())('email.security.unknownIp')).toEqual(
    expect.any(String),
  )
})

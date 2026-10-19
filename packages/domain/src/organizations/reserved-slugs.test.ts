import { expect, test } from 'vitest'
import { availableSlug, RESERVED_SLUGS, slugFromName } from './reserved-slugs.js'

test('a slug is lowercase, without accents, with dashes', () => {
  expect(slugFromName('La mia agenzia')).toBe('la-mia-agenzia')
  expect(slugFromName('  Caffè  Roma! ')).toBe('caffe-roma')
  expect(slugFromName('Ünïcode & Co.')).toBe('unicode-co')
})

test('a name without letters or digits still gets a slug', () => {
  expect(slugFromName('***')).toBe('agenzia')
})

test('a slug is never longer than 60 characters and never ends with a dash', () => {
  const slug = slugFromName(`${'a'.repeat(59)} b`)
  expect(slug.length).toBeLessThanOrEqual(60)
  expect(slug.endsWith('-')).toBe(false)
})

test('reserved and taken slugs get a numeric suffix', async () => {
  expect(RESERVED_SLUGS.has('profilo')).toBe(true)
  expect(await availableSlug('Profilo', () => false)).toBe('profilo-2')
  const taken = new Set(['agenzia-bianchi', 'agenzia-bianchi-2'])
  expect(await availableSlug('Agenzia Bianchi', (s) => taken.has(s))).toBe('agenzia-bianchi-3')
  expect(await availableSlug('Agenzia Rossi', (s) => taken.has(s))).toBe('agenzia-rossi')
})

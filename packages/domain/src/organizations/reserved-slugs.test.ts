import { expect, test } from 'vitest'
import {
  availableSlug,
  availableWorkspaceSlug,
  RESERVED_SLUGS,
  slugFromName,
} from './reserved-slugs.js'

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

test('workspace slugs: unique in the agency, no reserved words, their own fallback', async () => {
  const taken = new Set(['caffe-roma'])
  expect(await availableWorkspaceSlug('Caffè  Roma', (s) => taken.has(s))).toBe('caffe-roma-2')
  expect(await availableWorkspaceSlug('Caffè Roma', () => false)).toBe('caffe-roma')
  // workspaces live under /<agency>/spazi/<slug>: the panel roots do not clash with them
  expect(await availableWorkspaceSlug('Profilo', () => false)).toBe('profilo')
  expect(await availableWorkspaceSlug('★★', () => false)).toBe('spazio')
  expect(await availableWorkspaceSlug('★★', (s) => s === 'spazio')).toBe('spazio-2')
})

import { expect, test } from 'vitest'
import {
  profilesWithoutClient,
  proposeClients,
  proposedName,
  type FoundAccount,
} from './proposals.js'

const ig = (externalId: string, pageId: string | null, over: Partial<FoundAccount> = {}) => ({
  platform: 'instagram' as const,
  externalId,
  name: `IG ${externalId}`,
  username: externalId,
  pageId,
  inClient: false,
  ...over,
})
const fb = (externalId: string, over: Partial<FoundAccount> = {}) => ({
  platform: 'facebook' as const,
  externalId,
  name: `Pagina ${externalId}`,
  username: null,
  pageId: externalId,
  inClient: false,
  ...over,
})

test('an Instagram account and its Page make one proposal, Instagram first', () => {
  const [p, ...rest] = proposeClients([fb('p1'), ig('i1', 'p1')])
  expect(rest).toEqual([])
  expect(p).toMatchObject({ key: 'page:p1', externalIds: ['i1', 'p1'], together: 'paired' })
})

test('an account alone is a proposal of its own, and says so', () => {
  const proposals = proposeClients([ig('i1', null), fb('p2'), ig('i3', 'p9')])
  expect(proposals.map((p) => [p.externalIds, p.together])).toEqual([
    [['i1'], 'instagram_only'],
    [['p2'], 'facebook_only'],
    [['i3'], 'instagram_only'],
  ])
})

test('a profile is proposed as a new client only if none of its accounts is in a client', () => {
  const proposals = proposeClients([
    fb('p1', { inClient: true }),
    ig('i1', 'p1'),
    ig('i2', null),
    ig('i3', null, { inClient: true }),
  ])
  expect(proposals.map((p) => [p.key, p.checked, p.inClient])).toEqual([
    ['page:p1', false, true],
    ['account:instagram:i2', true, false],
    ['account:instagram:i3', false, true],
  ])
})

test('the proposed name comes from Instagram, then the Page, then the handle', () => {
  expect(
    proposedName([
      fb('p1', { name: 'Ottica Bellavista Roma' }),
      ig('i1', 'p1', { name: 'Ottica Bellavista' }),
    ]),
  ).toBe('Ottica Bellavista')
  expect(proposedName([fb('p1', { name: 'Fiorista Primula' })])).toBe('Fiorista Primula')
  expect(proposedName([ig('i1', null, { name: '  ', username: 'barcentrale' })])).toBe(
    'barcentrale',
  )
  expect(proposedName([ig('i1', null, { name: 'x'.repeat(120) })])).toHaveLength(80)
})

test('the proposed name is never shorter than a client name may be', () => {
  // a one-letter Instagram name falls back to what is longer
  expect(proposedName([ig('i1', null, { name: 'G', username: 'gelateria' })])).toBe('gelateria')
  expect(proposedName([ig('i1', null, { name: 'G', username: null })])).toBe('Nuovo cliente')
})

test('the profiles without a client: active accounts in no client, paired as on the platform', () => {
  const accounts = [
    { id: 'f1', platform: 'facebook' as const, pageId: 'p1', active: true },
    { id: 'i1', platform: 'instagram' as const, pageId: 'p1', active: true },
    { id: 'i2', platform: 'instagram' as const, pageId: null, active: true },
    { id: 'i3', platform: 'instagram' as const, pageId: null, active: false },
    { id: 'f4', platform: 'facebook' as const, pageId: 'p4', active: true },
  ]
  const profiles = profilesWithoutClient(accounts, new Set(['f4']))
  expect(profiles.map((p) => p.accounts.map((a) => a.id))).toEqual([['i1', 'f1'], ['i2']])
})

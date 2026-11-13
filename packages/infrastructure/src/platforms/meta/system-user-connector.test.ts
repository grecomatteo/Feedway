import { expect, test } from 'vitest'
import type {
  MetaFacebookPage,
  MetaGraphClient,
  MetaPage,
  MetaResult,
  MetaTokenInfo,
} from './graph-client.js'
import { MetaError } from './errors.js'
import {
  MAX_LIST_REQUESTS,
  classifiedListing,
  createMetaSystemUserConnector,
  listMetaAccounts,
} from './system-user-connector.js'

// The defensive paging of the account listing (plan 03 Task 6), with a hand-made client: the
// fake Graph API never sends pages that loop.

const USAGE = { app: null, business: [] }
const CREDENTIALS = { accessToken: 'token-di-prova', appSecret: 'segreto-di-prova' }

const page = (id: string): MetaFacebookPage => ({
  id,
  name: `Pagina ${id}`,
  pictureUrl: null,
  accessToken: 'token-della-pagina',
  tasks: [],
  instagramAccount: null,
})

const answer = <T>(items: T[], nextCursor: string | null): MetaResult<MetaPage<T>> => ({
  data: { items, nextCursor },
  usage: USAGE,
})

function clientOf(
  listUserPages: (after: string | undefined) => MetaResult<MetaPage<MetaFacebookPage>>,
) {
  const asked: (string | undefined)[] = []
  return {
    asked,
    client: {
      listUserPages: (_c: unknown, p?: { after?: string }) => {
        asked.push(p?.after)
        return Promise.resolve(listUserPages(p?.after))
      },
      listAssignedInstagramAccounts: () => Promise.resolve(answer([], null)),
    },
  }
}

test('pages are followed by their cursor until the last one', async () => {
  const { client, asked } = clientOf((after) =>
    after === undefined ? answer([page('1')], 'c1') : answer([page('2')], null),
  )
  const accounts = await listMetaAccounts(client, CREDENTIALS)
  expect(accounts.map((a) => a.externalId)).toEqual(['1', '2'])
  expect(asked).toEqual([undefined, 'c1'])
})

test('an assigned Instagram already seen through its page keeps that page, and comes once', async () => {
  const ig = (id: string) => ({ id, username: `ig${id}`, name: null, profilePictureUrl: null })
  const asked: (string | undefined)[] = []
  const client = {
    listUserPages: () =>
      Promise.resolve(answer([{ ...page('1'), instagramAccount: ig('10') }], null)),
    listAssignedInstagramAccounts: (_c: unknown, p?: { after?: string }) => {
      asked.push(p?.after)
      return Promise.resolve(
        p?.after === undefined ? answer([ig('10')], 'c1') : answer([ig('20')], null),
      )
    },
  }
  const accounts = await listMetaAccounts(client, CREDENTIALS)
  expect(accounts.map((a) => [a.platform, a.externalId, a.pageId])).toEqual([
    ['facebook', '1', '1'],
    ['instagram', '10', '1'],
    ['instagram', '20', null],
  ])
  expect(asked).toEqual([undefined, 'c1'])
})

test('a page already seen stops the listing: no endless loop', async () => {
  const { client, asked } = clientOf((after) => answer([page(after ?? '0')], 'sempre-lo-stesso'))
  expect(await classifiedListing(() => listMetaAccounts(client, CREDENTIALS))).toEqual({
    ok: false,
    reason: 'incomplete',
  })
  expect(asked).toHaveLength(2)
})

test('a listing stops after its request budget', async () => {
  let n = 0
  const { client, asked } = clientOf(() => answer([page(String(n))], `c${String(++n)}`))
  expect(await classifiedListing(() => listMetaAccounts(client, CREDENTIALS))).toEqual({
    ok: false,
    reason: 'incomplete',
  })
  expect(asked).toHaveLength(MAX_LIST_REQUESTS)
})

test('Meta errors become a refusal or no answer; other errors are not hidden', async () => {
  const failing = (error: Error) => () => Promise.reject(error)
  expect(
    await classifiedListing(failing(new MetaError({ kind: 'permanent', reason: 'token_invalid' }))),
  ).toEqual({ ok: false, reason: 'rejected' })
  expect(
    await classifiedListing(failing(new MetaError({ kind: 'transient', reason: 'rate_limited' }))),
  ).toEqual({ ok: false, reason: 'unavailable' })
  await expect(classifiedListing(failing(new TypeError('bug')))).rejects.toThrow('bug')
})

const APP = { appId: '1000000000000001', appSecret: 'segreto-di-prova', version: new Date(0) }
const VALID: MetaTokenInfo = {
  isValid: true,
  type: 'SYSTEM_USER',
  appId: APP.appId,
  userId: '4000000000000001',
  expiresAt: 'never',
  dataAccessExpiresAt: 'never',
  issuedAt: null,
  scopes: [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'instagram_basic',
    'instagram_content_publish',
    'business_management',
  ],
  granularScopes: [],
  error: null,
}

const checkWith = (info: MetaTokenInfo) =>
  createMetaSystemUserConnector({
    client: {
      debugToken: () => Promise.resolve({ data: info, usage: USAGE }),
    } as unknown as MetaGraphClient,
    integrations: { credentials: () => Promise.resolve(null) },
  }).connectWithToken?.(APP, 'token-incollato')

test('a valid system user token passes, and does not expire', async () => {
  expect(await checkWith(VALID)).toMatchObject({
    ok: true,
    externalUserId: VALID.userId,
    expiresAt: null,
  })
})

test.each([
  ['of another app', { ...VALID, appId: '1999999999999999' }],
  ['of a page', { ...VALID, type: 'PAGE' }],
  ['of the app itself', { ...VALID, type: 'APP' }],
  ['without a user', { ...VALID, userId: null }],
  ['not valid', { ...VALID, isValid: false }],
])('a token %s is refused', async (_why, info) => {
  expect(await checkWith(info)).toEqual({ ok: false, reason: 'rejected', permissions: [] })
})

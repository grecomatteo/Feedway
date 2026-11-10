import { expect, test } from 'vitest'
import type { MetaFacebookPage, MetaPage, MetaResult } from './graph-client.js'
import { MetaError } from './errors.js'
import { MAX_LIST_REQUESTS, classifiedListing, listMetaAccounts } from './system-user-connector.js'

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
      listBusinessPages: () => Promise.resolve(answer<MetaFacebookPage>([], null)),
      listBusinessInstagramAccounts: () => Promise.resolve(answer([], null)),
    },
  }
}

test('pages are followed by their cursor until the last one', async () => {
  const { client, asked } = clientOf((after) =>
    after === undefined ? answer([page('1')], 'c1') : answer([page('2')], null),
  )
  const accounts = await listMetaAccounts(client, CREDENTIALS, null)
  expect(accounts.map((a) => a.externalId)).toEqual(['1', '2'])
  expect(asked).toEqual([undefined, 'c1'])
})

test('a page already seen stops the listing: no endless loop', async () => {
  const { client, asked } = clientOf((after) => answer([page(after ?? '0')], 'sempre-lo-stesso'))
  expect(await classifiedListing(() => listMetaAccounts(client, CREDENTIALS, null))).toEqual({
    ok: false,
    reason: 'unavailable',
  })
  expect(asked).toHaveLength(2)
})

test('a listing stops after its request budget', async () => {
  let n = 0
  const { client, asked } = clientOf(() => answer([page(String(n))], `c${String(++n)}`))
  expect(await classifiedListing(() => listMetaAccounts(client, CREDENTIALS, null))).toEqual({
    ok: false,
    reason: 'unavailable',
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

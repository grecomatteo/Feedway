import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { META_MOCK, startMetaMock, type MetaMock } from './index.ts'

let mock: MetaMock

beforeEach(async () => {
  mock = await startMetaMock()
})

afterEach(async () => {
  await mock.stop()
})

const proof = (token: string) =>
  createHmac('sha256', META_MOCK.app.secret).update(token).digest('hex')

/** The parts of Graph API answers these tests read. */
interface Answer {
  data: ({ id: string } & Record<string, unknown>)[]
  paging: { cursors: { after: string }; next?: string }
  client_business_id?: string
  error: { code: number }
}

async function graph(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${mock.url}/v25.0${path}`)
  for (const [k, v] of Object.entries({ ...params, appsecret_proof: proof(token) }))
    url.searchParams.set(k, v)
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
  return { status: res.status, headers: res.headers, body: (await res.json()) as Answer }
}

const ids = (body: { data: { id: string }[] }) => body.data.map((item) => item.id)

test('the system user sees the pages of the agency business, with their Instagram accounts', async () => {
  const token = META_MOCK.tokens.systemUser
  const accounts = await graph('/me/accounts', token, {
    fields: 'id,name,access_token,tasks,instagram_business_account{id,username}',
  })
  expect(accounts.status).toBe(200)
  expect(accounts.body.data).toEqual([
    expect.objectContaining({
      id: META_MOCK.pages.withInstagram,
      access_token: expect.any(String) as string,
      instagram_business_account: { id: META_MOCK.instagram.ofPage, username: 'fornoluce' },
    }),
    expect.objectContaining({
      id: META_MOCK.pages.withoutInstagram,
      access_token: expect.any(String) as string,
    }),
  ])
  expect(accounts.body.data[1]).not.toHaveProperty('instagram_business_account')
  expect(accounts.headers.get('x-app-usage')).not.toBeNull()

  const igOnly = await graph(`/${META_MOCK.businesses.agency}/instagram_business_accounts`, token, {
    fields: 'id,username',
  })
  expect(ids(igOnly.body)).toEqual([META_MOCK.instagram.agencyOnly, META_MOCK.instagram.shared])

  const limit = await graph(`/${META_MOCK.instagram.ofPage}/content_publishing_limit`, token, {
    fields: 'quota_usage,config',
  })
  expect(limit.body.data[0]).toEqual({
    quota_usage: expect.any(Number) as number,
    config: { quota_total: 50, quota_duration: 86400 },
  })
})

test('the unified login goes from the dialog to a token that sees the client portfolio', async () => {
  const redirectUri = 'https://panel.test/connessioni/meta_business_login/ritorno'
  const dialog = new URL(`${mock.url}/v25.0/dialog/oauth`)
  dialog.search = new URLSearchParams({
    client_id: META_MOCK.app.id,
    config_id: META_MOCK.app.configId,
    redirect_uri: redirectUri,
    state: 'org.random',
    response_type: 'code',
    override_default_response_type: 'true',
  }).toString()
  const back = new URL((await fetch(dialog, { redirect: 'manual' })).headers.get('location') ?? '')
  expect(back.origin + back.pathname).toBe(redirectUri)
  expect(back.searchParams.get('state')).toBe('org.random')

  const exchange = new URL(`${mock.url}/v25.0/oauth/access_token`)
  exchange.search = new URLSearchParams({
    client_id: META_MOCK.app.id,
    client_secret: META_MOCK.app.secret,
    code: back.searchParams.get('code') ?? '',
    redirect_uri: redirectUri,
  }).toString()
  const exchanged = (await (await fetch(exchange)).json()) as { access_token: string }
  const token = exchanged.access_token
  expect(token).toBe(META_MOCK.tokens.businessLogin)

  const reused = await fetch(exchange)
  expect(reused.status).toBe(400)

  const me = await graph('/me', token, { fields: 'id,client_business_id' })
  expect(me.body.client_business_id).toBe(META_MOCK.businesses.client)
  const igAccounts = await graph(
    `/${META_MOCK.businesses.client}/instagram_business_accounts`,
    token,
  )
  expect(ids(igAccounts.body)).toEqual([META_MOCK.instagram.clientOnly, META_MOCK.instagram.shared])

  const debug = new URL(`${mock.url}/v25.0/debug_token`)
  debug.search = new URLSearchParams({
    input_token: token,
    access_token: `${META_MOCK.app.id}|${META_MOCK.app.secret}`,
  }).toString()
  const debugged = (await (await fetch(debug)).json()) as { data: Record<string, unknown> }
  expect(debugged.data).toMatchObject({
    is_valid: true,
    user_id: META_MOCK.users.clientIntegration,
  })
})

test('lists are paginated with cursors', async () => {
  const token = META_MOCK.tokens.systemUser
  const first = await graph('/me/accounts', token, { limit: '1' })
  expect(ids(first.body)).toEqual([META_MOCK.pages.withInstagram])
  expect(first.body.paging.next).toEqual(expect.any(String))
  const second = await graph('/me/accounts', token, {
    limit: '1',
    after: first.body.paging.cursors.after,
  })
  expect(ids(second.body)).toEqual([META_MOCK.pages.withoutInstagram])
  expect(second.body.paging.next).toBeUndefined()
})

test('a Graph API call without a valid appsecret_proof is rejected', async () => {
  const token = META_MOCK.tokens.systemUser
  const call = (query: string) =>
    fetch(`${mock.url}/v25.0/me/accounts${query}`, {
      headers: { authorization: `Bearer ${token}` },
    })

  const missing = await call('')
  expect(missing.status).toBe(400)
  expect(((await missing.json()) as Answer).error.code).toBe(100)
  const wrong = await call(`?appsecret_proof=${proof('another-token')}`)
  expect(wrong.status).toBe(400)
  expect(mock.calls().map((c) => c.path)).toEqual(['/me/accounts', '/me/accounts'])
})

test('a login request with an invalid return address answers 400 and the mock keeps running', async () => {
  const dialog = new URL(`${mock.url}/v25.0/dialog/oauth`)
  dialog.search = new URLSearchParams({
    client_id: META_MOCK.app.id,
    config_id: META_MOCK.app.configId,
    redirect_uri: 'not a url',
    state: 's',
  }).toString()
  expect((await fetch(dialog, { redirect: 'manual' })).status).toBe(400)
  expect((await graph('/me', META_MOCK.tokens.systemUser)).status).toBe(200)
})

test('debug_token on the app token itself describes the app; a wrong secret is refused', async () => {
  const appToken = `${META_MOCK.app.id}|${META_MOCK.app.secret}`
  const debug = (accessToken: string) => {
    const url = new URL(`${mock.url}/v25.0/debug_token`)
    url.search = new URLSearchParams({
      input_token: appToken,
      access_token: accessToken,
    }).toString()
    return fetch(url)
  }
  const ok = await debug(appToken)
  expect(ok.status).toBe(200)
  expect(((await ok.json()) as { data: unknown }).data).toEqual({
    app_id: META_MOCK.app.id,
    type: 'APP',
    application: 'Feedway',
    is_valid: true,
    scopes: [],
  })
  const wrong = await debug(`${META_MOCK.app.id}|segreto-sbagliato`)
  expect(wrong.status).toBe(400)
  expect(((await wrong.json()) as { error: { code: number } }).error.code).toBe(190)
})

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { META_MOCK, startMetaMock, type MetaMock } from '@app/meta-mock'
import type { Logger } from '@app/application'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { fixedClock } from '../../testing/index.js'
import { MetaError, type MetaErrorKind, type MetaErrorReason } from './errors.js'
import { createMetaGraphClient, type MetaGraphClient } from './graph-client.js'

// The client against the fake Graph API (plan 03, Task 3). No database needed: unit project.

let mock: MetaMock
let client: MetaGraphClient
let lines: string[]

function memoryLogger(): Logger {
  const log: Logger = {
    debug: (obj, msg) => lines.push(JSON.stringify({ obj, msg })),
    info: (obj, msg) => lines.push(JSON.stringify({ obj, msg })),
    warn: (obj, msg) => lines.push(JSON.stringify({ obj, msg })),
    error: (obj, msg) => lines.push(JSON.stringify({ obj, msg })),
    child: () => log,
  }
  return log
}

beforeEach(async () => {
  mock = await startMetaMock()
  lines = []
  client = createMetaGraphClient({
    mode: 'mock',
    version: 'v25.0',
    baseUrl: mock.url,
    clock: fixedClock(new Date('2026-11-09T12:00:00Z')),
    logger: memoryLogger(),
    timeoutMs: 200,
    retryBaseDelayMs: 1,
  })
})

afterEach(async () => {
  await mock.stop()
})

const app = { appId: META_MOCK.app.id, appSecret: META_MOCK.app.secret }
const systemUser = { accessToken: META_MOCK.tokens.systemUser, appSecret: META_MOCK.app.secret }
const REDIRECT = 'https://panel.test/connessioni/meta_business_login/ritorno'

async function codeFromDialog(): Promise<string> {
  const url = client.loginDialogUrl({
    appId: app.appId,
    configId: META_MOCK.app.configId,
    redirectUri: REDIRECT,
    state: 'org.random',
  })
  const res = await fetch(url, { redirect: 'manual' })
  return new URL(res.headers.get('location') ?? '').searchParams.get('code') ?? ''
}

async function failure(promise: Promise<unknown>): Promise<MetaError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(MetaError)
  return err as MetaError
}

describe('successful calls', () => {
  test('unified login: dialog, code exchange, token info and client portfolio', async () => {
    const dialog = new URL(
      client.loginDialogUrl({
        appId: app.appId,
        configId: META_MOCK.app.configId,
        redirectUri: REDIRECT,
        state: 'org.random',
      }),
    )
    expect(Object.fromEntries(dialog.searchParams)).toMatchObject({
      config_id: META_MOCK.app.configId,
      response_type: 'code',
      override_default_response_type: 'true',
    })
    expect(dialog.searchParams.has('scope')).toBe(false)

    const exchanged = await client.exchangeCode(app, {
      code: await codeFromDialog(),
      redirectUri: REDIRECT,
    })
    const credentials = { accessToken: exchanged.data.accessToken, appSecret: app.appSecret }

    const info = await client.debugToken(app, exchanged.data.accessToken)
    expect(info.data).toMatchObject({
      isValid: true,
      userId: META_MOCK.users.clientIntegration,
      expiresAt: 'never',
      error: null,
    })
    expect(info.data.scopes).toContain('instagram_content_publish')

    const me = await client.getMe(credentials)
    expect(me.data.clientBusinessId).toBe(META_MOCK.businesses.client)

    const accounts = await client.listBusinessInstagramAccounts(credentials, {
      businessId: META_MOCK.businesses.client,
    })
    expect(accounts.data.items.map((a) => a.username)).toEqual(['palestra.nord', 'caffe.centrale'])

    const calls = mock.calls()
    expect(calls.find((c) => c.path === '/oauth/access_token')?.params).not.toHaveProperty(
      'appsecret_proof',
    )
    expect(calls.find((c) => c.path === '/me')).toMatchObject({ tokenIn: 'header' })
    expect(calls.find((c) => c.path === '/me')?.params).toHaveProperty('appsecret_proof')
  })

  test('system user: pages with their tokens and Instagram accounts, page after page', async () => {
    const first = await client.listUserPages(systemUser, { limit: 1 })
    expect(first.data.items).toEqual([
      expect.objectContaining({
        id: META_MOCK.pages.withInstagram,
        name: 'Forno Luce',
        accessToken: META_MOCK.tokens.page(META_MOCK.pages.withInstagram),
        instagramAccount: expect.objectContaining({
          id: META_MOCK.instagram.ofPage,
          username: 'fornoluce',
        }) as unknown,
      }),
    ])
    expect(first.data.nextCursor).not.toBeNull()
    expect(first.usage.app).toEqual(
      expect.objectContaining({ callCount: expect.any(Number) as number }),
    )
    expect(first.usage.business[0]?.businessId).toBe(META_MOCK.businesses.agency)

    const second = await client.listUserPages(systemUser, {
      limit: 1,
      after: first.data.nextCursor ?? '',
    })
    expect(second.data.items.map((p) => [p.id, p.instagramAccount])).toEqual([
      [META_MOCK.pages.withoutInstagram, null],
    ])
    expect(second.data.nextCursor).toBeNull()

    const owned = await client.listBusinessPages(systemUser, {
      businessId: META_MOCK.businesses.agency,
      relation: 'owned',
    })
    expect(owned.data.items.map((p) => p.id)).toEqual([META_MOCK.pages.withInstagram])
    const partner = await client.listBusinessPages(systemUser, {
      businessId: META_MOCK.businesses.agency,
      relation: 'client',
    })
    expect(partner.data.items.map((p) => p.id)).toEqual([META_MOCK.pages.withoutInstagram])

    const assigned = await client.listAssignedInstagramAccounts(systemUser)
    expect(assigned.data.items.map((a) => a.id)).toEqual([
      META_MOCK.instagram.agencyOnly,
      META_MOCK.instagram.shared,
      META_MOCK.instagram.ofPage,
    ])

    const profile = await client.getInstagramAccount(systemUser, META_MOCK.instagram.agencyOnly)
    expect(profile.data).toMatchObject({ username: 'studio.rossi', name: 'Studio Rossi' })
  })

  test('publishing limit, also when the quota is used up', async () => {
    const limit = await client.getPublishingLimit(systemUser, META_MOCK.instagram.ofPage)
    expect(limit.data).toEqual({ quotaUsage: 2, quotaTotal: 50, quotaDurationSeconds: 86400 })

    mock.scenario('quota_exhausted')
    const exhausted = await client.getPublishingLimit(systemUser, META_MOCK.instagram.ofPage)
    expect(exhausted.data.quotaUsage).toBe(exhausted.data.quotaTotal)
  })

  test('a page without a role comes without a token', async () => {
    mock.scenario('page_without_token')
    const pages = await client.listUserPages(systemUser)
    expect(
      pages.data.items.find((p) => p.id === META_MOCK.pages.withoutInstagram)?.accessToken,
    ).toBeNull()
  })
})

describe('error classification', () => {
  const rows: [
    string,
    { code: number; subcode?: number; status?: number },
    MetaErrorKind,
    MetaErrorReason,
  ][] = [
    ['190', { code: 190 }, 'permanent', 'token_invalid'],
    ['190/463', { code: 190, subcode: 463 }, 'permanent', 'token_invalid'],
    ['190/467', { code: 190, subcode: 467 }, 'permanent', 'token_invalid'],
    ['190/460', { code: 190, subcode: 460 }, 'permanent', 'token_invalid'],
    ['190/458', { code: 190, subcode: 458 }, 'permanent', 'token_revoked'],
    ['190/459', { code: 190, subcode: 459 }, 'permanent', 'checkpoint'],
    ['190/464', { code: 190, subcode: 464 }, 'permanent', 'checkpoint'],
    ['190/492', { code: 190, subcode: 492 }, 'permanent', 'page_role_missing'],
    ['10', { code: 10, status: 403 }, 'permanent', 'permission_missing'],
    ['200', { code: 200, status: 403 }, 'permanent', 'permission_missing'],
    ['299', { code: 299, status: 403 }, 'permanent', 'permission_missing'],
    ['3', { code: 3 }, 'permanent', 'permission_missing'],
    ['100/33', { code: 100, subcode: 33 }, 'uncertain', 'not_found_or_forbidden'],
    ['4', { code: 4 }, 'transient', 'rate_limited'],
    ['17', { code: 17 }, 'transient', 'rate_limited'],
    ['32', { code: 32 }, 'transient', 'rate_limited'],
    ['613', { code: 613 }, 'transient', 'rate_limited'],
    ['80001', { code: 80001 }, 'transient', 'rate_limited'],
    ['80002', { code: 80002 }, 'transient', 'rate_limited'],
    ['341', { code: 341 }, 'transient', 'rate_limited'],
    ['368', { code: 368 }, 'transient', 'blocked'],
    ['368/1390008', { code: 368, subcode: 1390008 }, 'transient', 'blocked'],
    ['1', { code: 1, status: 500 }, 'transient', 'meta_unavailable'],
    ['2', { code: 2, status: 500 }, 'transient', 'meta_unavailable'],
    ['506', { code: 506 }, 'permanent', 'rejected'],
    ['100 other', { code: 100 }, 'permanent', 'rejected'],
    // Instagram publishing (Instagram Error Codes, not verified on Meta)
    ['9007/2207027', { code: 9007, subcode: 2207027 }, 'transient', 'media_not_ready'],
    ['9004/2207052', { code: 9004, subcode: 2207052 }, 'permanent', 'media_rejected'],
    ['352/2207026', { code: 352, subcode: 2207026 }, 'permanent', 'media_rejected'],
    ['36000/2207004', { code: 36000, subcode: 2207004 }, 'permanent', 'media_rejected'],
    ['36003/2207009', { code: 36003, subcode: 2207009 }, 'permanent', 'media_rejected'],
    ['-2/2207020', { code: -2, subcode: 2207020 }, 'permanent', 'container_expired'],
    ['24/2207008', { code: 24, subcode: 2207008 }, 'permanent', 'container_expired'],
    ['-1/2207032', { code: -1, subcode: 2207032 }, 'transient', 'meta_unavailable'],
    ['-1/2207001', { code: -1, subcode: 2207001 }, 'transient', 'meta_unavailable'],
    ['-2/2207003', { code: -2, subcode: 2207003 }, 'transient', 'meta_unavailable'],
    ['9/2207042', { code: 9, subcode: 2207042 }, 'transient', 'quota_exhausted'],
    ['25/2207050', { code: 25, subcode: 2207050 }, 'permanent', 'account_restricted'],
  ]

  test.each(rows)('%s', async (_label, error, kind, reason) => {
    mock.scenario('error', { ...error, path: '/me/accounts' })
    const err = await failure(client.listUserPages(systemUser))
    expect({ kind: err.kind, reason: err.reason, metaCode: err.metaCode }).toEqual({
      kind,
      reason,
      metaCode: error.code,
    })
    expect(err.subcode).toBe(error.subcode ?? null)
    expect(err.fbtraceId).toEqual(expect.any(String))
    expect(err.message).not.toContain('meta-mock')
  })

  test('a malformed answer is uncertain and not retried', async () => {
    mock.scenario('malformed', { path: '/me/accounts' })
    const err = await failure(client.listUserPages(systemUser))
    expect([err.kind, err.reason]).toEqual(['uncertain', 'invalid_response'])

    mock.scenario('default')
    mock.scenario('malformed', { path: '/me', body: '{"id": 42}' })
    const wrongShape = await failure(client.getMe(systemUser))
    expect([wrongShape.kind, wrongShape.reason]).toEqual(['uncertain', 'invalid_response'])
    expect(mock.calls().filter((c) => c.path === '/me/accounts')).toHaveLength(1)
  })

  test('a rate limit keeps Retry-After and the usage, without retrying at once', async () => {
    mock.scenario('rate_limited', { code: 80002, minutesToRegain: 7 })
    const err = await failure(client.listUserPages(systemUser))
    expect([err.kind, err.reason]).toEqual(['transient', 'rate_limited'])
    expect(err.usage?.business[0]?.estimatedTimeToRegainAccessMinutes).toBe(7)
    expect(mock.calls()).toHaveLength(1)

    mock.scenario('default')
    mock.scenario('error', { code: 4, retryAfter: 30 })
    expect((await failure(client.listUserPages(systemUser))).retryAfterSeconds).toBe(30)
  })

  test('a timeout is uncertain, with no further attempt', async () => {
    mock.scenario('timeout', { delayMs: 1000 })
    const err = await failure(client.listUserPages(systemUser))
    expect([err.kind, err.reason]).toEqual(['uncertain', 'timeout'])
    expect(mock.calls()).toHaveLength(1)
  })

  test('a transient error is retried, then the client gives up after three attempts', async () => {
    mock.scenario('transient_error', { times: 1 })
    const pages = await client.listUserPages(systemUser)
    expect(pages.data.items).toHaveLength(2)
    expect(mock.calls()).toHaveLength(2)

    mock.scenario('default')
    mock.scenario('html_5xx', { status: 502 })
    const before = mock.calls().length
    const err = await failure(client.listUserPages(systemUser))
    expect([err.kind, err.reason, err.status]).toEqual(['transient', 'meta_unavailable', 502])
    expect(mock.calls().length - before).toBe(3)
  })

  test('the code exchange is never retried: the code works only once', async () => {
    const code = await codeFromDialog()
    mock.scenario('transient_error', { path: '/oauth/access_token' })
    const err = await failure(client.exchangeCode(app, { code, redirectUri: REDIRECT }))
    expect([err.kind, err.reason]).toEqual(['transient', 'meta_unavailable'])
    expect(mock.calls().filter((c) => c.path === '/oauth/access_token')).toHaveLength(1)
  })

  test('a non JSON 429 is transient', async () => {
    mock.scenario('html_5xx', { path: '/me', status: 429, times: 1 })
    const me = await client.getMe(systemUser)
    expect(me.data.id).toBe(META_MOCK.users.systemUser)
    expect(mock.calls().filter((c) => c.path === '/me')).toHaveLength(2)
  })

  test('an expired token shows up in debug_token too', async () => {
    mock.scenario('token_expired', { token: META_MOCK.tokens.systemUser })
    const info = await client.debugToken(app, META_MOCK.tokens.systemUser)
    expect(info.data).toMatchObject({ isValid: false, error: { code: 190, subcode: 463 } })
    expect(info.data.expiresAt).toBeInstanceOf(Date)
  })
})

test('dry-run reads Meta but never writes: a fake id, a finished container', async () => {
  const dry = createMetaGraphClient({
    mode: 'dry-run',
    version: 'v25.0',
    baseUrl: mock.url,
    clock: fixedClock(new Date('2026-11-09T12:00:00Z')),
    logger: memoryLogger(),
  })
  const signal = new AbortController().signal
  const ig = META_MOCK.instagram.ofPage
  const made = await dry.createInstagramContainer(systemUser, ig, { image_url: 'x' }, signal)
  expect(made.data.id).toMatch(/^dry-run-[0-9a-f]{16}$/)
  const status = await dry.getContainerStatus(systemUser, made.data.id, signal)
  expect(status.data.statusCode).toBe('FINISHED')
  const published = await dry.publishInstagramContainer(systemUser, ig, made.data.id, signal)
  expect(published.data.id).toMatch(/^dry-run-/)
  expect(mock.calls().filter((c) => c.method !== 'GET')).toEqual([])
  expect(mock.calls().some((c) => c.path.includes('dry-run'))).toBe(false)
  // reads still go to Meta
  await dry.getPublishingLimit(systemUser, ig)
  expect(mock.calls()).toHaveLength(1)
})

test('dry-run on a Page: the upload, the finish and the delete never leave', async () => {
  const dry = createMetaGraphClient({
    mode: 'dry-run',
    version: 'v25.0',
    baseUrl: mock.url,
    clock: fixedClock(new Date('2026-11-09T12:00:00Z')),
    logger: memoryLogger(),
  })
  const signal = new AbortController().signal
  const page = META_MOCK.pages.withInstagram
  const start = await dry.startPageVideoUpload(systemUser, page, 'video_reels', signal)
  expect(start.data.videoId).toMatch(/^dry-run-/)
  await dry.uploadHostedVideo(systemUser, start.data.videoId, 'https://x.invalid/v.mp4', signal)
  const story = await dry.finishPageVideoUpload(
    systemUser,
    page,
    'video_stories',
    { video_id: start.data.videoId },
    signal,
  )
  expect(story.data).toMatchObject({
    success: true,
    postId: expect.stringMatching(/^dry-run-/) as string,
  })
  await dry.deleteObject(systemUser, start.data.videoId, signal)
  const video = await dry.getFacebookVideo(systemUser, start.data.videoId, signal)
  expect(video.data.publishStatus).toBeNull()
  expect(mock.calls()).toEqual([])
})

test('no token, secret, proof or code reaches the log', async () => {
  const code = await codeFromDialog()
  const exchanged = await client.exchangeCode(app, { code, redirectUri: REDIRECT })
  await client.debugToken(app, exchanged.data.accessToken)
  await client.listUserPages(systemUser)
  mock.scenario('error', { code: 190, subcode: 463 })
  await failure(client.listUserPages(systemUser))
  await failure(client.exchangeCode(app, { code, redirectUri: REDIRECT }))

  const log = lines.join('\n')
  expect(lines.length).toBeGreaterThan(0)
  for (const secret of [
    META_MOCK.tokens.systemUser,
    META_MOCK.tokens.businessLogin,
    META_MOCK.tokens.page(META_MOCK.pages.withInstagram),
    META_MOCK.app.secret,
    code,
    'appsecret_proof',
  ])
    expect(log).not.toContain(secret)
})

describe('META_RECORD_DIR', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'meta-record-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const recordingClient = () =>
    createMetaGraphClient({
      mode: 'live',
      version: 'v25.0',
      baseUrl: mock.url,
      clock: fixedClock(new Date('2026-11-09T12:00:00Z')),
      logger: memoryLogger(),
      recordDir: dir,
    })

  test('two processes on the same folder never overwrite each other', async () => {
    // web and worker get the same META_RECORD_DIR and each starts counting from 1
    const web = recordingClient()
    const worker = recordingClient()
    await web.debugToken(app, META_MOCK.tokens.systemUser)
    await worker.debugToken(app, META_MOCK.tokens.systemUser)

    const files = await readdir(dir)
    expect(files).toHaveLength(2)
    for (const file of files) {
      const saved = await readFile(join(dir, file), 'utf8')
      expect(JSON.parse(saved)).toMatchObject({ call: 'debug_token', status: 200 })
      expect(saved).not.toContain(META_MOCK.tokens.systemUser)
    }
  })
})

import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { apiRoutes } from '@app/contracts'
import { seed, withScope } from '@app/infrastructure/testing'
import { errorCodeOf } from './identity-env.js'
import type { ErrorJson } from './identity-env.js'
import {
  PLACEHOLDER_IDS,
  fill,
  routeKey,
  idKindsIn,
  pathValues,
  sampleBody,
  sampleQuery,
  secretsIn,
  startIsolationFixture,
} from './support/isolation-fixture.js'
import type { IdKind, IsolationFixture, SampleIds } from './support/isolation-fixture.js'

let fx: IsolationFixture

beforeAll(async () => {
  fx = await startIsolationFixture('cross')
}, 300_000)

afterAll(async () => {
  await fx.env.stop()
})

beforeEach(async () => {
  // a refusal must come from the agency, not from a missing reauth
  await fx.refreshReauth()
})

const orgRoutes = apiRoutes.filter((r) => r.scope === 'organization')

/** Every agency route, plus its sample query where it has one (it names a workspace). */
const orgRequests = orgRoutes.flatMap((route) => [
  { route, method: route.method, path: route.path, withQuery: false },
  ...(sampleQuery(route, PLACEHOLDER_IDS) === undefined
    ? []
    : [{ route, method: route.method, path: `${route.path}?query`, withQuery: true }]),
])

type OrgRequest = (typeof orgRequests)[number]

function request(r: OrgRequest, ids: SampleIds) {
  const query = r.withQuery ? sampleQuery(r.route, ids) : undefined
  return {
    path: fill(r.route.path, pathValues(ids)) + (query === undefined ? '' : `?${query}`),
    body: sampleBody(r.route, ids),
  }
}

/** Not found, with nothing changed and nothing secret in the answer. */
async function expectNotFound(r: OrgRequest, ids: SampleIds, cookie: string) {
  const before = await fx.snapshot()
  const { path, body } = request(r, ids)
  const answer = await fx.env.call(r.method, path, body, { cookie })
  const text = await answer.text()
  expect(answer.status, `${path}: ${text}`).toBe(404)
  expect((JSON.parse(text) as ErrorJson).error.code).toBe('NOT_FOUND')
  expect(secretsIn(text)).toEqual([])
  expect(await fx.snapshot(), `${r.method} ${path} changed rows`).toEqual(before)
}

test('the scanner knows sealed columns and Meta tokens, and never echoes a whole token', () => {
  const token = `EAA${'Bx7'.repeat(20)}`
  expect(secretsIn(`{"a":"${token}"}`)).toEqual(['value EAABx7'])
  expect(secretsIn('{"a":"IGAAQ1w2e3r4t5y6u7i8o9p0"}')).toEqual(['value IGAAQ1'])
  expect(secretsIn('{"a":"v1.1.x","b":"secret_enc"}')).toEqual(['value secret'])
  expect(secretsIn('{"a":"token_enc"}')).toEqual(['value token_'])
  // words that only start like a token are not one
  expect(secretsIn('{"a":"EAAsy","b":"eaa1234567890123456789012"}')).toEqual([])
})

test.each(orgRequests)('member of B cannot reach A via $method $path', async (r) => {
  const ids = await fx.caseIds({ agency: 'a', actorsInWorkspace: true })
  for (const cookie of [fx.cookies.memberOfB, fx.cookies.ownerOfB])
    await expectNotFound(r, ids, cookie)
})

/**
 * Routes whose body ids of the other agency are not a 404 but an outcome: the checks before
 * scheduling say «non disponibile in questo cliente» for a file or an account that is not the
 * workspace's, whoever owns it (plan 05 Task 2). Their own case is below.
 */
const BODY_IDS_AS_OUTCOMES: Record<string, readonly IdKind[]> = {
  'POST /api/v1/orgs/{org}/workspaces/{id}/post-checks': ['media', 'account'],
}

/**
 * One id of the other agency at a time, the others of the agency in the path: a workspace of A
 * with a person of B, a workspace of B with a person of A, and so on, in both directions.
 */
const foreignIdCases = orgRequests.flatMap((r) =>
  idKindsIn(r.route, r.withQuery)
    .filter((kind) => !BODY_IDS_AS_OUTCOMES[routeKey(r.route)]?.includes(kind))
    .map((kind) => ({ ...r, kind })),
)

test('every id a request carries gets its own case', () => {
  // a request that names a workspace or a person and has no case would be skipped in silence
  for (const r of orgRequests)
    if (
      /\{(id|userId|inviteId|connectionId|accountId|mediaId|uploadId|folderId|postId|labelId|templateId|groupId|noteId)\}/.test(
        r.route.path,
      ) ||
      r.withQuery
    )
      expect(idKindsIn(r.route, r.withQuery), r.path).not.toEqual([])
})

test.each(foreignIdCases)('$kind of B inside the A path gives 404 on $method $path', async (c) => {
  const idsOfA = await fx.caseIds({ agency: 'a', actorsInWorkspace: true })
  const idsOfB = await fx.caseIds({ agency: 'b', actorsInWorkspace: true })
  await expectNotFound(c, { ...idsOfA, [c.kind]: idsOfB[c.kind] }, fx.cookies.owner)
  await expectNotFound(c, { ...idsOfB, [c.kind]: idsOfA[c.kind] }, fx.cookies.ownerOfB)
})

/** 403 ORGANIZATION_SUSPENDED, with nothing changed. */
async function expectSuspended(r: OrgRequest, ids: SampleIds, cookie: string) {
  const before = await fx.snapshot()
  const { path, body } = request(r, ids)
  const answer = await fx.env.call(r.method, path, body, { cookie })
  expect(answer.status, `${r.method} ${path}`).toBe(403)
  expect(await errorCodeOf(answer)).toBe('ORGANIZATION_SUSPENDED')
  expect(await fx.snapshot(), `${r.method} ${path} changed rows`).toEqual(before)
}

test('suspended organization routes answer 403 while the other agency works', async () => {
  const suspended = await fx.env.agency({ status: 'suspended' })
  await seed(fx.env.tdb.runtimeUrl, (s) => s.member(suspended.id, fx.both.userId, 'member'))
  const ids = await fx.caseIds({ agency: 'a', actorsInWorkspace: true })
  for (const r of orgRequests)
    await expectSuspended(r, { ...ids, org: suspended.slug }, fx.cookies.both)
  for (const slug of [fx.a.slug, fx.b.slug])
    expect(
      (
        await fx.env.call('GET', `/api/v1/orgs/${slug}/workspaces`, undefined, {
          cookie: fx.cookies.both,
        })
      ).status,
    ).toBe(200)
})

test.each(orgRequests)(
  'the Owner of a suspended agency gets 403 on its own rows: $method $path',
  async (r) => {
    const { cookie, ids } = await fx.throwawayAgency()
    // after the sign-in, as the platform does it: the session was opened on an active agency
    await withScope(fx.env.tdb.runtimeUrl, { kind: 'system' }, (c) =>
      c.query(
        "update organizations set status = 'suspended', suspended_at = now() where slug = $1",
        [ids.org],
      ),
    )
    await fx.refreshReauth()
    await expectSuspended(r, ids, cookie)
  },
)

test('a person who also works for B cannot be taken over from A', async () => {
  const r = await fx.env.call(
    'POST',
    `/api/v1/orgs/${fx.a.slug}/members/${fx.both.userId}/password-reset-link`,
    undefined,
    { cookie: fx.cookies.owner },
  )
  expect(r.status).toBe(403)
  expect(await errorCodeOf(r)).toBe('FORBIDDEN')
})

test('disabled in B, a person keeps A', async () => {
  const person = await fx.env.person(fx.b.id, 'member')
  await seed(fx.env.tdb.runtimeUrl, (s) => s.member(fx.a.id, person.userId, 'member'))
  const disabled = await fx.env.call(
    'POST',
    `/api/v1/orgs/${fx.b.slug}/members/${person.userId}/disable`,
    undefined,
    { cookie: fx.cookies.ownerOfB },
  )
  expect(disabled.status).toBe(200)
  // signed out everywhere (sessions are platform-wide), but A is still theirs
  const cookie = await fx.env.signIn(person)
  const workspaces = (slug: string) =>
    fx.env.call('GET', `/api/v1/orgs/${slug}/workspaces`, undefined, { cookie })
  expect((await workspaces(fx.a.slug)).status).toBe(200)
  expect((await workspaces(fx.b.slug)).status).toBe(404)
})

test('a file and an account of B in the checks of a post of A: blocked, with nothing of B', async () => {
  const idsOfA = await fx.caseIds({ agency: 'a', actorsInWorkspace: true })
  const idsOfB = await fx.caseIds({ agency: 'b', actorsInWorkspace: true })
  const before = await fx.snapshot()
  const r = await fx.env.call(
    'POST',
    `/api/v1/orgs/${idsOfA.org}/workspaces/${idsOfA.workspace}/post-checks`,
    {
      type: 'reel',
      mediaIds: [idsOfB.media],
      caption: { common: 'Il pane di oggi' },
      destinations: [{ accountId: idsOfB.account }],
      when: { mode: 'now' },
      choices: [],
    },
    { cookie: fx.cookies.owner },
  )
  const text = await r.text()
  expect(r.status, text).toBe(200)
  const report = JSON.parse(text) as {
    outcomes: { code: string }[]
    destinations: { accountId: string; platform: string | null; format: string | null }[]
    canSchedule: boolean
  }
  expect(report.outcomes.map((o) => o.code).sort()).toEqual([
    'account_unavailable',
    'media_unavailable',
  ])
  expect(report.destinations).toEqual([
    expect.objectContaining({ accountId: idsOfB.account, platform: null, format: null }),
  ])
  expect(report.canSchedule).toBe(false)
  // nothing of B's rows: no name, no platform, no file
  const ofB = await withScope(fx.env.tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query<{ name: string; original_name: string }>(
      `select a.name, m.original_name from social_accounts a, media m
        where a.id = $1 and m.id = $2`,
      [idsOfB.account, idsOfB.media],
    ),
  )
  for (const row of ofB.rows) {
    expect(text).not.toContain(row.name)
    expect(text).not.toContain(row.original_name)
  }
  expect(text).not.toMatch(/instagram|facebook/)
  expect(await fx.snapshot()).toEqual(before)
})

// Not about isolation: this file is the only test of `post-checks` over HTTP, and the 422 comes
// from the route, not from `checkPost`.
test('a choice its warning does not offer is a wrong body: 422 (D-54)', async () => {
  const idsOfA = await fx.caseIds({ agency: 'a', actorsInWorkspace: true })
  const body = (option: string) => ({
    type: 'reel',
    mediaIds: [idsOfA.media],
    caption: { common: 'Il pane di oggi' },
    destinations: [{ accountId: idsOfA.account }],
    // the hour the clocks skip: a warning that offers «accept» only
    when: { mode: 'at', localDate: '2027-03-28', localTime: '02:30' },
    choices: [{ key: 'time_skipped:post', option }],
  })
  const path = `/api/v1/orgs/${idsOfA.org}/workspaces/${idsOfA.workspace}/post-checks`
  const wrong = await fx.env.call('POST', path, body('skip_platform'), {
    cookie: fx.cookies.owner,
  })
  const text = await wrong.text()
  expect(wrong.status, text).toBe(422)
  expect(JSON.parse(text)).toMatchObject({
    error: { issues: [{ path: ['choices', 0] }] },
  })
  const right = await fx.env.call('POST', path, body('accept'), { cookie: fx.cookies.owner })
  expect(right.status).toBe(200)
})

// Last in this file: the person who spends the allowance has none left for a minute.
test('two people behind one address have each their own 120 checks a minute (D-57)', async () => {
  const idsOfA = await fx.caseIds({ agency: 'a', actorsInWorkspace: true })
  const path = `/api/v1/orgs/${idsOfA.org}/workspaces/${idsOfA.workspace}/post-checks`
  const body = {
    type: 'reel',
    mediaIds: [idsOfA.media],
    caption: { common: 'Il pane di oggi' },
    destinations: [{ accountId: idsOfA.account }],
    when: { mode: 'now' },
    choices: [],
  }
  const headers = { 'x-forwarded-for': '6.6.6.42' }
  const check = (cookie: string) => fx.env.call('POST', path, body, { cookie, headers })
  const statuses: number[] = []
  for (let n = 0; n < 121; n++) statuses.push((await check(fx.cookies.admin)).status)
  expect(statuses.slice(0, 120).every((s) => s === 200)).toBe(true)
  expect(statuses[120]).toBe(429)
  expect((await check(fx.cookies.editor)).status).toBe(200)
})

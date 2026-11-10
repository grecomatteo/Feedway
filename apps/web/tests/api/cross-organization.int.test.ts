import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { apiRoutes } from '@app/contracts'
import { seed, withScope } from '@app/infrastructure/testing'
import { errorCodeOf } from './identity-env.js'
import type { ErrorJson } from './identity-env.js'
import {
  PLACEHOLDER_IDS,
  fill,
  idKindsIn,
  pathValues,
  sampleBody,
  sampleQuery,
  secretsIn,
  startIsolationFixture,
} from './support/isolation-fixture.js'
import type { IsolationFixture, SampleIds } from './support/isolation-fixture.js'

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
 * One id of the other agency at a time, the others of the agency in the path: a workspace of A
 * with a person of B, a workspace of B with a person of A, and so on, in both directions.
 */
const foreignIdCases = orgRequests.flatMap((r) =>
  idKindsIn(r.route, r.withQuery).map((kind) => ({ ...r, kind })),
)

test('every id a request carries gets its own case', () => {
  // a request that names a workspace or a person and has no case would be skipped in silence
  for (const r of orgRequests)
    if (/\{(id|userId|inviteId|connectionId)\}/.test(r.route.path) || r.withQuery)
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

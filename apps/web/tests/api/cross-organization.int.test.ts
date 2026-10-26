import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { apiRoutes } from '@app/contracts'
import { seed } from '@app/infrastructure/testing'
import { errorCodeOf } from './identity-env.js'
import {
  PLACEHOLDER_IDS,
  carriesIds,
  fill,
  pathValues,
  sampleBody,
  sampleQuery,
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

function request(r: (typeof orgRequests)[number], ids: SampleIds) {
  const query = r.withQuery ? sampleQuery(r.route, ids) : undefined
  return {
    path: fill(r.route.path, pathValues(ids)) + (query === undefined ? '' : `?${query}`),
    body: sampleBody(r.route, ids),
  }
}

test.each(orgRequests)('member of B cannot reach A via $method $path', async (r) => {
  const { path, body } = request(r, await fx.caseIds({ agency: 'a', actorsInWorkspace: true }))
  for (const cookie of [fx.cookies.memberOfB, fx.cookies.ownerOfB]) {
    const answer = await fx.env.call(r.method, path, body, { cookie })
    expect(answer.status, path).toBe(404)
  }
})

/** Ids of the other agency in the path, the body or the query: never found. */
const orgRequestsWithIds = orgRequests.filter((r) => r.withQuery || carriesIds(r.route))

test('the requests that carry ids are the ones expected', () => {
  // a new route that carries ids joins the next battery by itself; this only guards the filter
  expect(orgRequestsWithIds.length).toBeGreaterThanOrEqual(12)
})

test.each(orgRequestsWithIds)('ids of B inside the A path give 404 on $method $path', async (r) => {
  const idsOfA = await fx.caseIds({ agency: 'a', actorsInWorkspace: true })
  const idsOfB = await fx.caseIds({ agency: 'b', actorsInWorkspace: true })
  // A's path, every id from B
  const intoA = request(r, { ...idsOfB, org: idsOfA.org })
  const asOwnerOfA = await fx.env.call(r.method, intoA.path, intoA.body, {
    cookie: fx.cookies.owner,
  })
  expect(asOwnerOfA.status, await asOwnerOfA.text()).toBe(404)
  // and the other way round
  const intoB = request(r, { ...idsOfA, org: idsOfB.org })
  const asOwnerOfB = await fx.env.call(r.method, intoB.path, intoB.body, {
    cookie: fx.cookies.ownerOfB,
  })
  expect(asOwnerOfB.status, await asOwnerOfB.text()).toBe(404)
})

test('suspended organization routes answer 403 while the other agency works', async () => {
  const suspended = await fx.env.agency({ status: 'suspended' })
  await seed(fx.env.tdb.runtimeUrl, (s) => s.member(suspended.id, fx.both.userId, 'member'))
  const ids = await fx.caseIds({ agency: 'a', actorsInWorkspace: true })
  for (const r of orgRequests) {
    const { path, body } = request(r, { ...ids, org: suspended.slug })
    const answer = await fx.env.call(r.method, path, body, { cookie: fx.cookies.both })
    expect(answer.status, path).toBe(403)
    expect(await errorCodeOf(answer)).toBe('ORGANIZATION_SUSPENDED')
  }
  for (const slug of [fx.a.slug, fx.b.slug])
    expect(
      (
        await fx.env.call('GET', `/api/v1/orgs/${slug}/workspaces`, undefined, {
          cookie: fx.cookies.both,
        })
      ).status,
    ).toBe(200)
})

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

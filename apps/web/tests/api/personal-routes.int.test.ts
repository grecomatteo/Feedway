import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { apiRoutes } from '@app/contracts'
import type { ApiContract } from '@app/contracts'
import { imageFixture } from '@app/infrastructure/testing'
import type { ErrorJson } from './identity-env.js'
import { fill, routeKey, sampleBody, startIsolationFixture } from './support/isolation-fixture.js'
import type { IsolationFixture, SampleIds } from './support/isolation-fixture.js'

let fx: IsolationFixture

beforeAll(async () => {
  fx = await startIsolationFixture('personal')
}, 300_000)

afterAll(async () => {
  await fx.env.stop()
})

beforeEach(async () => {
  await fx.refreshReauth()
})

test('every registered route belongs to exactly one battery', () => {
  expect(
    apiRoutes.every((r) => ['organization', 'personal', 'platform', 'public'].includes(r.scope)),
  ).toBe(true)
  // agency routes carry the agency; the others never do
  for (const r of apiRoutes)
    expect(r.path.startsWith('/api/v1/orgs/{org}/'), routeKey(r)).toBe(r.scope === 'organization')
  // a public route answers anyone, a personal or agency route needs a session
  for (const r of apiRoutes)
    if (r.scope !== 'public') expect(r.auth, routeKey(r)).not.toBe('public')
})

const personalRoutes = apiRoutes.filter((r) => r.scope === 'personal')
const personalRoutesWithIds = personalRoutes.filter((r) => /\{\w+\}/.test(r.path))
const personalRoutesWithoutIds = personalRoutes.filter((r) => !/\{\w+\}/.test(r.path))

/**
 * Something of another person the route names in its path, and how to tell it is untouched.
 * A personal route with a parameter and no entry here fails the battery.
 */
/** A photo upload as the panel sends it. */
async function photoForm(): Promise<FormData> {
  const data = new FormData()
  data.append('file', new Blob([new Uint8Array(await imageFixture('photo.jpg'))]), 'foto.jpg')
  return data
}

/** A preview uploaded by the person of `cookie`, ready to crop. */
async function stagedPhoto(cookie: string): Promise<{ stagingId: string; previewUrl: string }> {
  const r = await fx.env.call('POST', '/api/v1/me/avatar', await photoForm(), { cookie })
  expect(r.status).toBe(200)
  return (await r.json()) as { stagingId: string; previewUrl: string }
}

/** Routes whose request needs something of the caller first (a file, a preview). */
const PREPARED_BODY: Record<string, (cookie: string) => Promise<unknown>> = {
  'POST /api/v1/me/avatar': () => photoForm(),
  'POST /api/v1/me/avatar/crop': async (cookie) => ({
    stagingId: (await stagedPhoto(cookie)).stagingId,
    x: 0,
    y: 0,
    size: 400,
  }),
}

const OWNED_BY_ANOTHER: Record<
  string,
  (fx: IsolationFixture) => Promise<{ values: Record<string, string>; untouched(): Promise<void> }>
> = {
  'DELETE /api/v1/me/sessions/{id}': async (f) => {
    const cookie = await f.env.signIn(f.a.people.viewer)
    const { rows } = await f.env.admin.pool.query<{ id: string }>(
      'select id from sessions where user_id = $1',
      [f.a.people.viewer.userId],
    )
    return {
      values: { id: rows[0]?.id ?? '' },
      async untouched() {
        expect((await f.env.call('GET', '/api/v1/me', undefined, { cookie })).status).toBe(200)
        expect(
          (
            await f.env.admin.pool.query('select 1 from sessions where user_id = $1', [
              f.a.people.viewer.userId,
            ])
          ).rowCount,
        ).toBe(rows.length)
      },
    }
  },
  'GET /api/v1/me/avatar/staging/{id}': async (f) => {
    const preview = await stagedPhoto(f.cookies.viewer)
    return {
      values: { id: preview.stagingId },
      async untouched() {
        const own = await f.env.call('GET', preview.previewUrl, undefined, {
          cookie: f.cookies.viewer,
        })
        expect(own.status).toBe(200)
      },
    }
  },
  'GET /api/v1/users/{id}/avatar/{size}': async (f) => {
    const cookie = f.cookies.viewer
    const preview = await stagedPhoto(cookie)
    const crop = await f.env.call(
      'POST',
      '/api/v1/me/avatar/crop',
      { stagingId: preview.stagingId, x: 0, y: 0, size: 400 },
      { cookie },
    )
    expect(crop.status).toBe(200)
    const path = `/api/v1/users/${f.a.people.viewer.userId}/avatar/256`
    return {
      values: { id: f.a.people.viewer.userId, size: '256' },
      async untouched() {
        expect((await f.env.call('GET', path, undefined, { cookie })).status).toBe(200)
      },
    }
  },
  'POST /api/v1/links/{token}/complete': async (f) => {
    const { token, userId } = await f.reservedLink()
    return {
      values: { token },
      async untouched() {
        const { rows } = await f.env.admin.pool.query<{ used_at: Date | null }>(
          'select used_at from invites where reserved_user_id = $1',
          [userId],
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]?.used_at).toBeNull()
      },
    }
  },
}

/**
 * Not found, as if it did not exist. Exception: completing a link reserved for someone else
 * answers 401 "sign in with your account" (activation, Task 12): the link stays theirs.
 */
interface ForeignAnswer {
  status: number
  code: string
  /** tells this refusal apart from a missing session, which has the same code */
  message?: RegExp
}
const NOT_FOUND: ForeignAnswer = { status: 404, code: 'NOT_FOUND' }
const FOREIGN_ANSWER: Record<string, ForeignAnswer> = {
  'POST /api/v1/links/{token}/complete': {
    status: 401,
    code: 'UNAUTHENTICATED',
    message: /^Accedi con il tuo account/,
  },
}

const noIds: SampleIds = {
  org: '',
  workspace: '',
  target: '',
  newcomer: '',
  admin: '',
  email: '',
  invite: '',
}

test('every personal route with a parameter has a case', () => {
  expect(personalRoutesWithIds.map(routeKey).filter((k) => !(k in OWNED_BY_ANOTHER))).toEqual([])
})

test.each(personalRoutesWithIds)(
  'user cannot act on data of another user via $method $path',
  async (route: ApiContract) => {
    const owned = OWNED_BY_ANOTHER[routeKey(route)]
    if (!owned) throw new Error(`no case for ${routeKey(route)}`)
    const target = await owned(fx)
    const r = await fx.env.call(
      route.method,
      fill(route.path, target.values),
      sampleBody(route, noIds),
      {
        cookie: fx.cookies.memberOfB,
      },
    )
    const expected = FOREIGN_ANSWER[routeKey(route)] ?? NOT_FOUND
    const text = await r.text()
    expect(r.status, text).toBe(expected.status)
    const { error } = JSON.parse(text) as ErrorJson
    expect(error.code).toBe(expected.code)
    if (expected.message) expect(error.message).toMatch(expected.message)
    await target.untouched()
  },
)

test.each(personalRoutesWithoutIds)(
  '$method $path answers about the caller only',
  async (route: ApiContract) => {
    const other = fx.a.people.viewer
    const cookie = await fx.env.signIn(fx.b.member)
    await fx.refreshReauth()
    const prepared = PREPARED_BODY[routeKey(route)]
    const body = prepared ? await prepared(cookie) : sampleBody(route, noIds)
    const r = await fx.env.call(route.method, route.path, body, { cookie })
    const text = await r.text()
    expect(r.status, text).toBe(200)
    expect(text).not.toContain(other.userId)
    expect(text).not.toContain(other.email)
    // the other person is still signed in
    expect(
      (await fx.env.call('GET', '/api/v1/me', undefined, { cookie: fx.cookies.viewer })).status,
    ).toBe(200)
  },
)

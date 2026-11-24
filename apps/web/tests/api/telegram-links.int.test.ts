import { afterAll, beforeAll, expect, test } from 'vitest'
import { TELEGRAM_MOCK } from '@app/telegram-mock'
import { startApiEnv } from './identity-env.js'
import type { ApiEnv } from './identity-env.js'

// «Collega Telegram» (plan 08 Task 7): the bots that write to the person, a link with a code
// valid 15 minutes, and the person's own unlinking. Only the fake Bot API.

let env: ApiEnv
let platformCookie: string

beforeAll(async () => {
  env = await startApiEnv('telegram-links')
  const own = await env.agency()
  const admin = await env.person(own.id, 'member')
  await env.admin.pool.query("update users set platform_role = 'admin' where id = $1", [
    admin.userId,
  ])
  await env.addPasskey(admin.userId)
  platformCookie = await env.strongSignIn(admin)
}, 300_000)

afterAll(async () => {
  await env.stop()
})

test('a member links the platform’s bot and unlinks it; the code never comes back twice', async () => {
  const agency = await env.agency()
  const person = await env.person(agency.id, 'member')
  const cookie = await env.signIn(person)
  const read = async () =>
    (await (await env.call('GET', '/api/v1/me/telegram', undefined, { cookie })).json()) as {
      bots: { bot: string; botUsername: string; linkedAt: string | null; pendingUntil: unknown }[]
    }
  // no bot yet: nothing to link
  expect(await read()).toEqual({ bots: [] })
  await env.reauth(platformCookie)
  const set = await env.call(
    'PUT',
    '/api/v1/platform/telegram-bot',
    { token: TELEGRAM_MOCK.bots.platform.token },
    { cookie: platformCookie },
  )
  expect(set.status, await set.text()).toBe(200)

  const { bots } = await read()
  expect(bots).toMatchObject([
    { bot: 'platform', botUsername: 'feedway_mock_bot', linkedAt: null, pendingUntil: null },
  ])
  const started = await env.call(
    'POST',
    '/api/v1/me/telegram/links',
    { bot: 'platform' },
    {
      cookie,
    },
  )
  expect(started.status, await started.clone().text()).toBe(200)
  const { url } = (await started.json()) as { url: string }
  expect(url).toMatch(/^https:\/\/t\.me\/feedway_mock_bot\?start=[A-Za-z0-9_-]{43}$/)
  expect((await read()).bots[0]?.pendingUntil).toEqual(expect.any(String))

  const unknown = await env.call(
    'POST',
    '/api/v1/me/telegram/links',
    { bot: agency.id },
    {
      cookie,
    },
  )
  expect(unknown.status).toBe(404)
  const gone = await env.call('DELETE', '/api/v1/me/telegram/links/platform', undefined, {
    cookie,
  })
  expect(gone.status).toBe(200)
  expect((await read()).bots[0]?.pendingUntil).toBeNull()
  expect((await env.call('GET', '/api/v1/me/telegram')).status).toBe(401)
})

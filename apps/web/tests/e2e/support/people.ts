import { randomInt, randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { createDb, createPasswordHasher } from '@app/infrastructure'
import { seed } from '@app/infrastructure/testing'

// low entropy on purpose: a made-up value, not a secret for the leak scanner
export const E2E_PASSWORD = 'cavallo-batteria-graffetta-lago'

export interface E2ePerson {
  userId: string
  email: string
  name: string
}

/** A member of a new agency, with a password. */
export async function newMember(name = 'Matteo Greco'): Promise<E2ePerson> {
  const runtimeUrl = process.env.E2E_DATABASE_URL
  const adminUrl = process.env.E2E_ADMIN_URL
  if (!runtimeUrl || !adminUrl) throw new Error('e2e database not available')
  const email = `e2e-${randomUUID().slice(0, 8)}@example.test`
  const userId = await seed(runtimeUrl, async (s) => {
    const org = await s.organization()
    const id = await s.user({ email, name })
    await s.member(org, id, 'member')
    return id
  })
  const admin = createDb(adminUrl, { max: 1, applicationName: 'e2e-people' })
  try {
    await admin.pool.query(
      `insert into accounts (id, account_id, provider_id, user_id, password, updated_at)
       values ($1, $2::text, 'credential', $2::uuid, $3, now())`,
      [randomUUID(), userId, await createPasswordHasher().hash(E2E_PASSWORD)],
    )
  } finally {
    await admin.close()
  }
  return { userId, email, name }
}

/** A password sign-in as the panel does it; the session cookie lands in the page's context. */
export async function signIn(request: APIRequestContext, person: E2ePerson) {
  const baseURL = process.env.E2E_BASE_URL
  if (!baseURL) throw new Error('e2e server not available')
  const res = await request.post('/api/auth/sign-in/email', {
    headers: {
      origin: new URL(baseURL).origin,
      'x-app-request': '1',
      // each sign-in from its own address: the per-address limit is not what these tests measure
      'x-forwarded-for': `10.60.${String(randomInt(250))}.${String(randomInt(250))}`,
    },
    data: { email: person.email, password: E2E_PASSWORD },
  })
  expect(res.status()).toBe(200)
}

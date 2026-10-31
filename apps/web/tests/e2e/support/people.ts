import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { createDb, createPasswordHasher } from '@app/infrastructure'
import { secretOf, seed, totpCode } from '@app/infrastructure/testing'

// low entropy on purpose: a made-up value, not a secret for the leak scanner
export const E2E_PASSWORD = 'cavallo-batteria-graffetta-lago'

export interface E2ePerson {
  userId: string
  email: string
  name: string
  /** The agency's slug (the seed uses its id). */
  organizationSlug: string
}

/** A member of a new agency, with a password. */
export async function newMember(name = 'Matteo Greco'): Promise<E2ePerson> {
  return newPerson(name, 'member')
}

/** Someone with a password and the given role in a new agency. */
export async function newPerson(
  name: string,
  role: 'owner' | 'admin' | 'member',
): Promise<E2ePerson> {
  const runtimeUrl = process.env.E2E_DATABASE_URL
  const adminUrl = process.env.E2E_ADMIN_URL
  if (!runtimeUrl || !adminUrl) throw new Error('e2e database not available')
  const email = `e2e-${randomUUID().slice(0, 8)}@example.test`
  const { userId, organizationSlug } = await seed(runtimeUrl, async (s) => {
    const org = await s.organization()
    const id = await s.user({ email, name })
    await s.member(org, id, role)
    return { userId: id, organizationSlug: org }
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
  return { userId, email, name, organizationSlug }
}

/** A new agency with an invite for `email`; returns the activation path and the agency slug. */
export async function inviteLink(
  email: string,
  role: 'owner' | 'admin' | 'member' = 'member',
  organizationSlug?: string,
): Promise<{ path: string; organizationSlug: string }> {
  const runtimeUrl = process.env.E2E_DATABASE_URL
  if (!runtimeUrl) throw new Error('e2e database not available')
  const org = organizationSlug ?? (await seed(runtimeUrl, (s) => s.organization()))
  const token = randomBytes(32).toString('base64url')
  await adminQuery(
    `insert into invites (id, organization_id, purpose, email, token_hash, org_role, memberships, expires_at)
     values ($1, $2, 'invite', $3, $4, $5, '[]', now() + interval '1 hour')`,
    [randomUUID(), org, email, createHash('sha256').update(token, 'utf8').digest(), role],
  )
  return { path: `/attiva/${token}`, organizationSlug: org }
}

/** A "Password dimenticata" link for the person, as the email carries it. */
export async function resetLink(userId: string): Promise<string> {
  const token = randomBytes(24).toString('base64url')
  await adminQuery(
    `insert into verifications (id, identifier, value, expires_at, created_at, updated_at)
     values ($1, $2, $3, now() + interval '1 hour', now(), now())`,
    [randomUUID(), `reset-password:${token}`, userId],
  )
  return `/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent('/reimposta')}`
}

/** Signs in from the page as a person would, past the passkey offer. */
export async function signInFromPage(page: Page, person: { email: string }) {
  await page.goto('/accedi')
  await page.getByLabel('Email', { exact: true }).fill(person.email)
  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD)
  await page.getByRole('button', { name: 'Accedi con la password' }).click()
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

/** A query on the test database as its owner, to check what a test cannot see in the page. */
export async function adminQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const adminUrl = process.env.E2E_ADMIN_URL
  if (!adminUrl) throw new Error('e2e database not available')
  const admin = createDb(adminUrl, { max: 1, applicationName: 'e2e-check' })
  try {
    return (await admin.pool.query(sql, params)).rows as T[]
  } finally {
    await admin.close()
  }
}

/** Requests of this page from an address of its own: the per-address limits are not under test. */
export function ownAddress(page: Page) {
  return page.setExtraHTTPHeaders({
    'x-forwarded-for': `10.61.${String(randomInt(250))}.${String(randomInt(250))}`,
  })
}

/** Someone with a password and the given role in an existing agency. */
export async function addPerson(
  organizationSlug: string,
  name: string,
  role: 'owner' | 'admin' | 'member',
  workspaces: { workspaceId: string; role: 'manager' | 'publisher' | 'editor' | 'viewer' }[] = [],
): Promise<E2ePerson> {
  const runtimeUrl = process.env.E2E_DATABASE_URL
  if (!runtimeUrl) throw new Error('e2e database not available')
  const email = `e2e-${randomUUID().slice(0, 8)}@example.test`
  const userId = await seed(runtimeUrl, async (s) => {
    const id = await s.user({ email, name })
    await s.member(organizationSlug, id, role)
    for (const w of workspaces) await s.workspaceMember(organizationSlug, w.workspaceId, id, w.role)
    return id
  })
  await adminQuery(
    `insert into accounts (id, account_id, provider_id, user_id, password, updated_at)
     values ($1, $2::text, 'credential', $2::uuid, $3, now())`,
    [randomUUID(), userId, await createPasswordHasher().hash(E2E_PASSWORD)],
  )
  return { userId, email, name, organizationSlug }
}

/** A passkey row, enough for "has a second factor" (it never signs anything). */
export async function addPasskeyRow(userId: string): Promise<void> {
  await adminQuery(
    `insert into passkeys (id, name, public_key, user_id, credential_id, counter, device_type, backed_up, created_at)
     values ($1, 'Portatile', 'chiave-finta', $2, $3, 0, 'multiDevice', true, now())`,
    [randomUUID(), userId, randomBytes(16).toString('base64url')],
  )
}

/** Signs in and turns on the authenticator app, as an Owner or Admin must; returns the key. */
export async function signInWithTotp(request: APIRequestContext, person: E2ePerson) {
  await signIn(request, person)
  const headers = {
    origin: new URL(process.env.E2E_BASE_URL ?? '').origin,
    'x-app-request': '1',
    // the per-address limit on the code is not what these tests measure
    'x-forwarded-for': `10.62.${String(randomInt(250))}.${String(randomInt(250))}`,
  }
  const enabled = await request.post('/api/auth/two-factor/enable', {
    headers,
    data: { password: E2E_PASSWORD },
  })
  expect(enabled.status()).toBe(200)
  const { totpURI } = (await enabled.json()) as { totpURI: string }
  const secret = secretOf(totpURI)
  const verified = await request.post('/api/auth/two-factor/verify-totp', {
    headers,
    data: { code: totpCode(secret) },
  })
  expect(verified.status()).toBe(200)
  return secret
}

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { createSignedTokens } from '@app/infrastructure'
import { E2E_PASSWORD, adminQuery, newMember, ownAddress, signIn } from './support/people.ts'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(({ baseURL }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
})

/** The "Non sono stato io" link of a security email, signed as the worker would sign it. */
function lockLink(userId: string): string {
  const key = process.env.E2E_ENCRYPTION_KEY
  if (!key) throw new Error('e2e encryption key not available')
  const now = new Date()
  const token = createSignedTokens(Buffer.from(key, 'base64')).sign('security_lock', {
    userId,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
  })
  return `/sicurezza/non-sono-stato-io?t=${encodeURIComponent(token)}`
}

test('one device is signed out from the devices page, then all of them', async ({
  page,
  browser,
  baseURL,
}) => {
  const person = await newMember()
  const other = await browser.newContext({ baseURL: baseURL ?? '' })
  try {
    const elsewhere = await other.newPage()
    await signIn(elsewhere.request, person)
    await signIn(page.request, person)

    await page.goto('/account/dispositivi')
    const devices = page.getByRole('list', { name: 'Dispositivi collegati' })
    await expect(devices.getByRole('listitem')).toHaveCount(2)
    // only the other device has its own "Esci": this one leaves with "Esci da tutti"
    await expect(
      devices.getByRole('listitem').filter({ hasText: 'Questo dispositivo' }),
    ).toHaveCount(1)
    await devices.getByRole('button', { name: /^Esci da / }).click()
    await expect(page.getByRole('status')).toHaveText('Il dispositivo è uscito.')
    await expect(devices.getByRole('listitem')).toHaveCount(1)
    await elsewhere.goto('/account/dispositivi')
    await expect(elsewhere).toHaveURL(/\/accedi\?dopo=/)

    await signIn(elsewhere.request, person)
    await page.reload()
    await expect(devices.getByRole('listitem')).toHaveCount(2)
    await page.getByRole('button', { name: 'Esci da tutti i dispositivi' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Esci da tutti' }).click()
    await expect(page.getByRole('status')).toHaveText('Sei uscito da tutti i dispositivi.')

    await elsewhere.reload()
    await expect(elsewhere).toHaveURL(/\/accedi\?dopo=/)
    await page.reload()
    await expect(page).toHaveURL(/\/accedi\?dopo=/)
    const left = await adminQuery<{ n: string }>(
      'select count(*) as n from sessions where user_id = $1',
      [person.userId],
    )
    expect(left[0]?.n).toBe('0')
  } finally {
    await other.close()
  }
})

test('the not-me link locks the account after the button is pressed', async ({ page }) => {
  const person = await newMember()
  await signIn(page.request, person)
  await ownAddress(page)
  await page.goto(lockLink(person.userId))
  await expect(page.getByRole('button', { name: 'Blocca il mio account' })).toBeVisible()
  // the token leaves the address bar, and opening the link changes nothing: mail scanners open links too
  await expect(page).toHaveURL(/\/sicurezza\/non-sono-stato-io$/)
  const before = await adminQuery<{ status: string }>('select status from users where id = $1', [
    person.userId,
  ])
  expect(before[0]?.status).toBe('active')

  await page.getByRole('button', { name: 'Blocca il mio account' }).click()
  await expect(page.getByRole('status')).toContainText('Account bloccato.')
  const after = await adminQuery<{ status: string }>('select status from users where id = $1', [
    person.userId,
  ])
  expect(after[0]?.status).toBe('disabled')

  // the session of this browser is gone, and the password no longer opens one
  await page.goto('/account')
  await expect(page).toHaveURL(/\/accedi\?dopo=/)
  const baseURL = process.env.E2E_BASE_URL ?? ''
  const res = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: new URL(baseURL).origin, 'x-app-request': '1' },
    data: { email: person.email, password: E2E_PASSWORD },
  })
  expect(res.status()).not.toBe(200)
})

test('a not-me link that does not work says so', async ({ page }) => {
  await ownAddress(page)
  await page.goto('/sicurezza/non-sono-stato-io?t=link-non-valido')
  await page.getByRole('button', { name: 'Blocca il mio account' }).click()
  await expect(page.getByRole('alert')).toContainText('Il link non è valido o è scaduto')
  await page.goto('/sicurezza/non-sono-stato-io')
  await expect(page.getByRole('alert')).toContainText('Il link è incompleto.')
})

test('security screens have no a11y violations', async ({ page }) => {
  const person = await newMember()
  await signIn(page.request, person)
  const ready: Record<string, string> = {
    '/account/sicurezza': 'Cambia password',
    '/account/dispositivi': 'Esci da tutti i dispositivi',
    '/sicurezza/non-sono-stato-io?t=prova': 'Blocca il mio account',
  }
  for (const [path, button] of Object.entries(ready)) {
    await page.goto(path)
    await expect(page.getByRole('button', { name: button })).toBeVisible()
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(results.violations, path).toEqual([])
  }
})

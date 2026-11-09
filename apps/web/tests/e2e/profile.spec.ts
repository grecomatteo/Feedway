import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { newMember, signIn } from './support/people.ts'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(({ baseURL }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
})

test('profile edits are saved and theme follows the user to a new device', async ({
  page,
  browser,
  baseURL,
}) => {
  const person = await newMember()
  await signIn(page.request, person)
  await page.goto('/account')
  await expect(page.getByRole('heading', { level: 1, name: 'Il mio account' })).toBeVisible()

  const profile = page.getByRole('region', { name: 'Nome e soprannome' })
  await profile.getByRole('textbox', { name: 'Soprannome' }).fill('Teo')
  await profile.getByRole('button', { name: 'Salva' }).click()
  await expect(profile.getByRole('status')).toHaveText('Modifiche salvate.')
  await expect(page.getByTitle('Matteo Greco')).toHaveText('Teo')

  const preferences = page.getByRole('region', { name: 'Preferenze' })
  await preferences.getByRole('radio', { name: 'Scuro' }).check()
  await preferences.getByRole('button', { name: 'Salva' }).click()
  await expect(preferences.getByRole('status')).toHaveText('Modifiche salvate.')
  await expect(page.locator('html')).toHaveClass(/dark/)

  // another browser, signed in from scratch: the theme comes with the profile
  const other = await browser.newContext({ baseURL: baseURL ?? '', colorScheme: 'light' })
  try {
    const elsewhere = await other.newPage()
    await signIn(elsewhere.request, person)
    await elsewhere.goto('/account')
    await expect(elsewhere.getByRole('textbox', { name: 'Soprannome' })).toHaveValue('Teo')
    await expect(elsewhere.locator('html')).toHaveClass(/dark/)
  } finally {
    await other.close()
  }
})

test('the theme button keeps the choice in the profile, so a new visit keeps it', async ({
  page,
  browser,
  baseURL,
}) => {
  const person = await newMember()
  await signIn(page.request, person)
  await page.goto('/account')
  await expect(page.getByRole('heading', { level: 1, name: 'Il mio account' })).toBeVisible()
  // a new person follows the system until the first choice
  const wasDark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
  if (wasDark) await expect(page.locator('html')).toHaveClass(/dark/)
  else await expect(page.locator('html')).not.toHaveClass(/dark/)
  const saved: number[] = []
  page.on('response', (r) => {
    if (r.url().endsWith('/api/v1/me') && r.request().method() === 'PATCH') saved.push(r.status())
  })
  const html = page.locator('html')
  // under load the first click can land before the page is interactive: click until it turns
  await expect(async () => {
    await page.getByRole('button', { name: 'Passa al tema chiaro o scuro' }).first().click()
    if (wasDark) await expect(html).not.toHaveClass(/dark/, { timeout: 2000 })
    else await expect(html).toHaveClass(/dark/, { timeout: 2000 })
  }).toPass()
  await expect.poll(() => saved).toEqual([200])

  // another browser whose system says the opposite: the profile wins
  const other = await browser.newContext({
    baseURL: baseURL ?? '',
    colorScheme: wasDark ? 'dark' : 'light',
  })
  try {
    const elsewhere = await other.newPage()
    await signIn(elsewhere.request, person)
    await elsewhere.goto('/account')
    if (wasDark) await expect(elsewhere.locator('html')).not.toHaveClass(/dark/)
    else await expect(elsewhere.locator('html')).toHaveClass(/dark/)
  } finally {
    await other.close()
  }
})

test('a wrong nickname gets its error next to the field', async ({ page }) => {
  const person = await newMember()
  await signIn(page.request, person)
  await page.goto('/account')
  const profile = page.getByRole('region', { name: 'Nome e soprannome' })
  await profile.getByRole('textbox', { name: 'Soprannome' }).fill('a'.repeat(31))
  await profile.getByRole('button', { name: 'Salva' }).click()
  await expect(profile.getByText('Il soprannome può avere al massimo 30 caratteri')).toBeVisible()
})

test('without a session the account page leads to the sign-in page', async ({ page }) => {
  await page.goto('/account')
  await expect(page).toHaveURL(/\/accedi\?dopo=/)
})

test('the confirmation page refuses a link that does not work', async ({ page }) => {
  await page.goto('/conferma-email?t=link-non-valido')
  await page.getByRole('button', { name: 'Conferma il nuovo indirizzo' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  // the token does not stay in the address bar
  expect(new URL(page.url()).search).toBe('')
})

test('profile and confirmation pages have no a11y violations', async ({ page }) => {
  const person = await newMember()
  await signIn(page.request, person)
  for (const path of ['/account', '/conferma-email?t=prova']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    if (path === '/account')
      await expect(page.getByRole('textbox', { name: 'Soprannome' })).toBeVisible()
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])
  }
})

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { runDataExportJob } from './support/jobs.ts'
import { E2E_PASSWORD, newMember, signIn } from './support/people.ts'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(({ baseURL }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
})

/** The whole account in one file: the panel asks for the password first. */
async function confirmPassword(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Conferma che sei tu' })
  await dialog.getByLabel('Password').fill(E2E_PASSWORD)
  await dialog.getByRole('button', { name: 'Conferma' }).click()
  await expect(dialog).toBeHidden()
}

// one path through the screen: first the data, then the account (as the page suggests)
test('download my data, then delete my account', async ({ page }) => {
  const person = await newMember('Chiara Russo')
  await signIn(page.request, person)
  await page.goto('/account/privacy')
  const section = page.getByRole('region', { name: 'I tuoi dati' })
  await section.getByRole('button', { name: 'Scarica i miei dati' }).click()
  await confirmPassword(page)

  const status = section.getByRole('status')
  await expect(status).toHaveText(/Stiamo preparando il file/)
  const steps = section.getByRole('list', { name: 'Avanzamento' })
  await expect(steps.locator('[aria-current="step"]')).toHaveText('In preparazione')
  // no second request while one is being prepared
  await expect(section.getByRole('button', { name: /Scarica i miei dati|nuovo file/ })).toHaveCount(
    0,
  )

  const axe = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(axe.violations).toEqual([])

  // the page asks again every 3 seconds: no reload needed
  await runDataExportJob(person.userId)
  await expect(status).toHaveText('Il file è pronto.', { timeout: 10_000 })
  await expect(steps.locator('[aria-current="step"]')).toHaveText('Pronto')
  await expect(section.getByText(/Scaricabile fino al/)).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    section.getByRole('button', { name: 'Scarica il file' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^dati-personali-\d{4}-\d{2}-\d{2}\.zip$/)

  const deletion = page.getByRole('region', { name: 'Elimina il mio account' })
  await deletion.getByRole('button', { name: 'Elimina il mio account' }).click()
  const confirm = page.getByRole('dialog', { name: "Eliminare l'account?" })
  const final = confirm.getByRole('button', { name: 'Elimina definitivamente' })
  await expect(final).toBeDisabled()
  await confirm.getByLabel(/Per confermare scrivi la tua email/).fill(person.email.toUpperCase())
  await final.click()
  // the confirmation from the download is still recent: no second password
  await expect(page).toHaveURL(/\/account-eliminato$/)
  await expect(page.getByRole('heading', { name: 'Account eliminato' })).toBeVisible()
  await page.goto('/account/privacy')
  await expect(page).toHaveURL(/\/accedi/)
})

// the notice is a screen of its own: one path, from the sign-in page
test('the privacy notice opens from the sign-in page', async ({ page }) => {
  await page.goto('/accedi')
  await page.getByRole('link', { name: 'Informativa privacy' }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Cookie' })).toBeVisible()
  await expect(page.getByText('__Host-device')).toBeVisible()
  const axe = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(axe.violations).toEqual([])
})

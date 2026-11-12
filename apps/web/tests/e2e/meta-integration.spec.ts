import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { META_MOCK } from '@app/meta-mock'
import {
  E2E_PASSWORD,
  addDataKey,
  addPerson,
  newPerson,
  ownAddress,
  signInWithTotp,
} from './support/people.ts'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

async function confirmWithPassword(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Conferma che sei tu' })
  await dialog.getByLabel('Password').fill(E2E_PASSWORD)
  await dialog.getByRole('button', { name: 'Conferma' }).click()
}

test('meta integration: the owner saves and tries the app, the admin only reads it', async ({
  page,
  browser,
  baseURL,
}) => {
  const owner = await newPerson('Olga Meta', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await addDataKey(org)
  await page.goto(`/${org}/impostazioni`)
  await page
    .getByRole('navigation', { name: 'Sezioni delle impostazioni' })
    .getByRole('link', { name: 'Integrazioni' })
    .click()
  await expect(page.getByRole('heading', { name: 'Meta', exact: true })).toBeVisible()
  await expect(page.getByTestId('meta-integration-state')).toHaveText('Da configurare')
  await expect(page.getByText('Meta li aggiunge da solo')).toBeVisible()
  expect((await axe(page)).violations).toEqual([])

  // a secret Meta refuses is not saved
  await page.getByLabel('App ID').fill(META_MOCK.app.id)
  await page.getByLabel('App Secret').fill('non-e-il-secret')
  await page.getByRole('button', { name: 'Salva e verifica' }).click()
  await confirmWithPassword(page)
  await expect(page.getByText('Meta non accetta questo App ID con questo App Secret')).toBeVisible()
  await expect(page.getByTestId('meta-integration-state')).toHaveText('Da configurare')

  await page.getByLabel('App Secret').fill(META_MOCK.app.secret)
  await page.getByLabel('Scadenza del Data Use Checkup').fill('2027-03-31')
  await page.getByRole('button', { name: 'Salva e verifica' }).click()
  await expect(page.getByRole('status')).toHaveText(
    'Salvata: Meta ha accettato App ID e App Secret.',
  )
  await expect(page.getByTestId('meta-integration-state')).toHaveText('Funziona')
  // the secret never comes back
  await expect(page.getByLabel('App Secret')).toHaveValue('')

  await page.getByRole('button', { name: 'Prova' }).click()
  await expect(page.getByRole('status')).toHaveText('Funziona: Meta accetta App ID e App Secret.')
  expect((await axe(page)).violations).toEqual([])

  const admin = await addPerson(org, 'Ada Admin', 'admin')
  const context = await browser.newContext({ baseURL: baseURL ?? '' })
  const adminPage = await context.newPage()
  await ownAddress(adminPage)
  await signInWithTotp(adminPage.request, admin)
  await adminPage.goto(`/${org}/impostazioni/integrazioni`)
  await expect(adminPage.getByLabel('App ID')).toHaveValue(META_MOCK.app.id)
  await expect(adminPage.getByLabel('App ID')).toBeDisabled()
  await expect(adminPage.getByText('impostato (non si rilegge mai)')).toBeVisible()
  await expect(adminPage.getByRole('button', { name: 'Salva e verifica' })).toHaveCount(0)
  await expect(adminPage.getByRole('button', { name: 'Prova' })).toHaveCount(0)
  await context.close()
})

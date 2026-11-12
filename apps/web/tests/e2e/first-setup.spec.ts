import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { META_MOCK } from '@app/meta-mock'
import {
  E2E_PASSWORD,
  addDataKey,
  addPerson,
  newPerson,
  ownAddress,
  signIn,
  signInWithTotp,
} from './support/people.ts'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

const current = (page: Page) =>
  page.getByRole('list', { name: 'Passi' }).locator('[aria-current="step"]')

test('first setup: the five steps, interrupted and taken up again', async ({ page }) => {
  const owner = await newPerson('Olga Inizia', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await addDataKey(org)

  // the home says where the setup is
  await page.goto(`/${org}`)
  await page.getByRole('link', { name: 'Riprendi la prima configurazione' }).click()
  await expect(page.getByRole('heading', { name: 'Prima configurazione', level: 1 })).toBeVisible()
  await expect(current(page)).toContainText("Crea l'app Meta")
  expect((await axe(page)).violations).toEqual([])

  // step 1: the app, checked by Meta
  await page.getByLabel('App ID').fill(META_MOCK.app.id)
  await page.getByLabel('App Secret').fill(META_MOCK.app.secret)
  await page.getByRole('button', { name: 'Salva e verifica' }).click()
  // the sign-in may still count as a recent confirmation
  const dialog = page.getByRole('dialog', { name: 'Conferma che sei tu' })
  const next = current(page).filter({ hasText: "Crea l'utente di sistema" })
  await expect(dialog.or(next)).toBeVisible()
  if (await dialog.isVisible()) {
    await dialog.getByLabel('Password').fill(E2E_PASSWORD)
    await dialog.getByRole('button', { name: 'Conferma' }).click()
  }
  await expect(current(page)).toContainText("Crea l'utente di sistema")

  // interrupted: the data says where it stopped
  await page.reload()
  await expect(current(page)).toContainText("Crea l'utente di sistema")
  await page.getByRole('button', { name: 'Fatto, avanti' }).click()
  await expect(current(page)).toContainText('Assegna Pagine e Instagram')
  // the new step's heading takes the focus
  await expect(page.getByRole('heading', { name: 'Assegna Pagine e Instagram' })).toBeFocused()
  await page.getByRole('button', { name: 'Fatto, avanti' }).click()
  await expect(current(page)).toContainText('Genera e incolla il token')
  // a step seen again does not undo the next ones
  await page.getByRole('button', { name: /2\. Crea l'utente di sistema/ }).click()
  await page.getByRole('button', { name: 'Fatto, avanti' }).click()
  await expect(current(page)).toContainText('Assegna Pagine e Instagram')
  await page.getByRole('button', { name: /4\. Genera e incolla il token/ }).click()
  await expect(current(page)).toContainText('Genera e incolla il token')
  await expect(page.getByText('instagram_content_publish')).toBeVisible()

  // step 4: the token
  await page.getByRole('button', { name: 'Incolla il token', exact: true }).click()
  const token = page.getByRole('dialog', { name: 'Incolla il token' })
  await token.getByLabel("Token dell'utente di sistema").fill(META_MOCK.tokens.systemUser)
  await token.getByRole('button', { name: 'Verifica e salva' }).click()
  await expect(current(page)).toContainText('Importa gli account')

  // step 5: the accounts
  await page
    .getByRole('group', { name: 'Account trovati' })
    .getByRole('checkbox', { name: /Studio Rossi/ })
    .check()
  expect((await axe(page)).violations).toEqual([])
  await page.getByRole('button', { name: 'Importa 1 account' }).click()
  await expect(page.getByRole('heading', { name: 'Configurazione completata' })).toBeVisible()

  await page.goto(`/${org}`)
  await expect(page.getByRole('link', { name: 'Riprendi la prima configurazione' })).toHaveCount(0)
})

test('first setup: only the Owner', async ({ page }) => {
  const admin = await newPerson('Ada Configura', 'admin')
  await signInWithTotp(page.request, admin)
  const org = admin.organizationSlug
  await page.goto(`/${org}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Riprendi la prima configurazione' })).toHaveCount(0)
  await page.goto(`/${org}/configurazione`)
  await expect(page.getByRole('heading', { name: 'Pagina non trovata' })).toBeVisible()

  const member = await addPerson(org, 'Mario Configura', 'member')
  await page.context().clearCookies()
  await signIn(page.request, member)
  await page.goto(`/${org}/configurazione`)
  await expect(page.getByRole('heading', { name: 'Pagina non trovata' })).toBeVisible()
})

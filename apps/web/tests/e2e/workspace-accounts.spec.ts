import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { assignAccount, connectedAgency } from './support/meta.ts'
import {
  addPerson,
  adminQuery,
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

/** The list of «Clienti»: a table on a computer, rows on a phone. */
const clientList = (page: Page) =>
  page.getByRole('table', { name: 'Clienti' }).or(page.getByRole('list', { name: 'Clienti' }))

async function createClient(page: Page, name: string) {
  await expect(page.locator('[data-ready]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Nuovo cliente' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nuovo cliente' })
  await dialog.getByLabel('Nome del nuovo cliente').fill(name)
  await dialog.getByRole('button', { name: 'Crea', exact: true }).click()
  await expect(clientList(page).getByRole('link', { name, exact: true })).toBeVisible()
}

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

test('client accounts: the owner assigns a profile and takes one account out', async ({ page }) => {
  const owner = await newPerson('Olga Assegna', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)

  await page.goto(`/${org}/spazi`)
  await createClient(page, 'Forno Luce')
  await clientList(page).getByRole('link', { name: 'Forno Luce', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Forno Luce', level: 1 })).toBeVisible()
  await expect(page.getByText('Nessun account in questo cliente')).toBeVisible()

  const free = page.getByRole('group', { name: 'Account da aggiungere' })
  await free.getByRole('checkbox', { name: /Pagina Facebook: Forno Luce/ }).check()
  await free.getByRole('checkbox', { name: /Instagram: Forno Luce/ }).check()
  await page.getByRole('button', { name: 'Aggiungi 2 account al cliente' }).click()

  // the page and its Instagram are one profile of the client
  const assigned = page.getByRole('list', { name: 'Account del cliente' })
  await expect(assigned.getByRole('heading', { level: 3, name: 'Forno Luce' })).toBeVisible()
  await expect(assigned.getByRole('listitem')).toHaveCount(3)
  expect((await axe(page)).violations).toEqual([])

  await assigned.getByRole('button', { name: /Togli Instagram: Forno Luce/ }).click()
  await expect(assigned.getByText('@fornoluce')).toHaveCount(0)
  await expect(free.getByRole('checkbox', { name: /Instagram: Forno Luce/ })).toBeVisible()
})

test('client accounts: a member of the client sees them and cannot change them', async ({
  page,
}) => {
  const owner = await newPerson('Olga Mostra', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)
  await page.goto(`/${org}/spazi`)
  await createClient(page, 'Bottega')
  const [ws] = await adminQuery<{ id: string; slug: string }>(
    "select id, slug from workspaces where organization_id = $1 and name = 'Bottega'",
    [org],
  )
  const [account] = await adminQuery<{ id: string }>(
    "select id from social_accounts where organization_id = $1 and name = 'Bottega Verde'",
    [org],
  )
  await assignAccount(page.request, org, ws?.id ?? '', account?.id ?? '')

  const viewer = await addPerson(org, 'Vera Vede', 'member', [
    { workspaceId: ws?.id ?? '', role: 'viewer' },
  ])
  await page.context().clearCookies()
  await signIn(page.request, viewer)
  await page.goto(`/${org}/spazi/${ws?.slug ?? ''}/account`)
  await expect(page.getByRole('list', { name: 'Account del cliente' })).toContainText(
    'Bottega Verde',
  )
  await expect(page.getByRole('button', { name: /Togli/ })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Account da aggiungere' })).toHaveCount(0)
})

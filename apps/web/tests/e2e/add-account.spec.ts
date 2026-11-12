import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { META_MOCK } from '@app/meta-mock'
import { metaApp } from './support/meta.ts'
import { newPerson, ownAddress, signInWithTotp } from './support/people.ts'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

test('add account: the system user token, then the accounts to import', async ({ page }) => {
  const owner = await newPerson('Olga Aggiunge', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await metaApp(page.request, org, { businessId: META_MOCK.businesses.agency })

  await page.goto(`/${org}/account`)
  await page.getByRole('link', { name: 'Aggiungi account' }).first().click()
  await expect(page.getByRole('heading', { name: 'Aggiungi account', level: 1 })).toBeVisible()
  await page.getByRole('radio', { name: /Sì, è nel Business Manager dell'agenzia/ }).check()
  // the guide opens the agency's own Business Manager
  await expect(page.getByRole('link', { name: /Utenti di sistema/ })).toHaveAttribute(
    'href',
    new RegExp(`business_id=${META_MOCK.businesses.agency}`),
  )
  expect((await axe(page)).violations).toEqual([])

  // no system user yet: its token first
  await page.getByRole('button', { name: "Collega l'utente di sistema" }).click()
  const dialog = page.getByRole('dialog', { name: "Collega l'utente di sistema" })
  await dialog.getByLabel("Token dell'utente di sistema").fill(META_MOCK.tokens.systemUser)
  await dialog.getByRole('button', { name: 'Verifica e salva' }).click()

  const found = page.getByRole('group', { name: 'Account trovati' })
  await expect(found.getByRole('checkbox')).not.toHaveCount(0)
  await found.getByRole('checkbox', { name: /Studio Rossi/ }).check()
  await found.getByRole('checkbox', { name: /Bottega Verde/ }).check()
  expect((await axe(page)).violations).toEqual([])
  await page.getByRole('button', { name: 'Importa 2 account' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Importati 2 account' })).toBeVisible()

  // a second search sees them as already there
  await page.getByRole('button', { name: 'Cerca nuovi account' }).click()
  await expect(found.getByText('Già importato')).toHaveCount(2)

  await page.getByRole('link', { name: 'Torna agli account social' }).click()
  const list = page.getByRole('list', { name: 'Account social' })
  await expect(list).toContainText('Studio Rossi')
  await expect(list).toContainText('Bottega Verde')
})

test('add account: a client with a Business Manager of its own gets a message', async ({
  page,
}) => {
  const owner = await newPerson('Olga Partner', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await metaApp(page.request, org, { businessId: META_MOCK.businesses.agency })

  await page.goto(`/${org}/account/aggiungi`)
  await page.getByRole('radio', { name: /è di un cliente con un Business Manager suo/ }).check()
  const message = page.getByRole('textbox', { name: 'Messaggio per il cliente' })
  await expect(message).toHaveValue(new RegExp(META_MOCK.businesses.agency))
  await expect(message).toHaveValue(/accesso come partner/)
  await expect(page.getByRole('button', { name: 'Copia' })).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
})

test('add account: without the Meta app it says where to set it', async ({ page }) => {
  const owner = await newPerson('Olga Senza App', 'owner')
  await signInWithTotp(page.request, owner)
  await page.goto(`/${owner.organizationSlug}/account/aggiungi`)
  await expect(page.getByText("Prima serve l'app Meta dell'agenzia")).toBeVisible()
  await expect(page.getByRole('link', { name: 'Impostazioni → Integrazioni' })).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(0)
})

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { META_MOCK } from '@app/meta-mock'
import { connectedAgency } from './support/meta.ts'
import { newPerson, ownAddress, signInWithTotp } from './support/people.ts'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

/** A calendar day `days` from now, as the Owner types it. */
const dayFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

test('social accounts: empty before anything is connected', async ({ page }) => {
  const owner = await newPerson('Olga Vuota', 'owner')
  await signInWithTotp(page.request, owner)
  // the bottom bar below 768 px has five fixed places: no link to this page there
  await page.goto(`/${owner.organizationSlug}/account`)
  await expect(page.getByRole('heading', { name: 'Account social', level: 1 })).toBeVisible()
  await expect(page.getByText('Nessun account collegato')).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
})

test('social accounts: profiles, reminders, sync and a new token', async ({ page }) => {
  const owner = await newPerson('Olga Account', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org, { dataUseCheckupDueOn: dayFromNow(10) })

  await page.goto(`/${org}/account`)
  const list = page.getByRole('list', { name: 'Account social' })
  // the page with its Instagram is one profile; the accounts are not checked yet (no worker)
  const fornoLuce = list.getByRole('listitem').filter({ hasText: 'Forno Luce' }).first()
  await expect(fornoLuce.getByRole('heading', { level: 2 })).toHaveText('Forno Luce')
  await expect(fornoLuce.getByTestId(`account-${META_MOCK.pages.withInstagram}`)).toBeVisible()
  await expect(fornoLuce.getByTestId(`account-${META_MOCK.instagram.ofPage}`)).toContainText(
    'Da controllare',
  )
  await expect(list).toContainText('Non assegnato a nessun cliente')

  const reminders = page.getByRole('region', { name: 'Da sistemare su Meta' })
  await expect(reminders).toContainText("Il Data Use Checkup dell'app Meta scade il")
  await expect(reminders).toContainText('tra 10 giorni')

  const connections = page.getByRole('region', { name: 'Collegamenti' })
  await expect(connections).toContainText('Utente di sistema Meta')
  await connections.getByRole('button', { name: 'Sincronizza' }).click()
  await expect(connections.getByRole('status')).toContainText('Sincronizzazione avviata')
  await connections.getByRole('button', { name: 'Sincronizza' }).click()
  await expect(connections.getByRole('alert')).toContainText('Hai già sincronizzato')

  await connections.getByRole('button', { name: 'Sostituisci token' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sostituisci token' })
  await dialog.getByLabel("Token dell'utente di sistema").fill(META_MOCK.tokens.systemUser)
  await dialog.getByRole('button', { name: 'Verifica e salva' }).click()
  // the reauth of the setup is recent: no "Conferma che sei tu"
  await expect(page.getByText('Token sostituito: il collegamento funziona di nuovo.')).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
})

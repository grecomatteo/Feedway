import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { META_MOCK } from '@app/meta-mock'
import { connectedAgency } from './support/meta.ts'
import { addPerson, newPerson, ownAddress, signIn, signInWithTotp } from './support/people.ts'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

/** A calendar day `days` from now in the panel's time zone, where the reminder counts days. */
const dayFromNow = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(
    new Date(Date.now() + days * 86_400_000),
  )

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
  const sync = connections.getByRole('button', { name: 'Sincronizza' })
  await sync.click()
  await expect(connections.getByRole('status')).toContainText('Sincronizzazione avviata')
  // one sync every 5 minutes: the button waits too, and says for how long
  // the countdown is not in the live region: it would be read again every minute
  await expect(connections).toContainText('Puoi sincronizzare di nuovo tra 5 minuti')
  await expect(connections.getByRole('status')).not.toContainText('Puoi sincronizzare')
  await expect(sync).toBeDisabled()
  // a page opened again does not know: the server's answer says how long is left
  await page.reload()
  await sync.click()
  await expect(connections.getByRole('status')).toContainText('Hai già sincronizzato')
  await expect(connections).toContainText(/Puoi sincronizzare di nuovo tra [1-5] minut/)
  await expect(sync).toBeDisabled()

  await connections.getByRole('button', { name: 'Sostituisci token' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sostituisci token' })
  await dialog.getByLabel("Token dell'utente di sistema").fill(META_MOCK.tokens.systemUser)
  await dialog.getByRole('button', { name: 'Verifica e salva' }).click()
  // the reauth of the setup is recent: no "Conferma che sei tu"
  await expect(page.getByText('Token sostituito: il collegamento funziona di nuovo.')).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
})

test('social accounts: a system user without accounts yet is listed as waiting', async ({
  page,
}) => {
  const owner = await newPerson('Olga Attesa', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org, { importAccounts: false })
  await page.goto(`/${org}/account`)
  const connections = page.getByRole('region', { name: 'Collegamenti' })
  await expect(connections).toContainText('Utente di sistema Meta')
  await expect(connections).toContainText('in attesa dei primi account')
  await expect(page.getByText('Nessun account collegato')).toBeVisible()
})

test('social accounts: an admin manages them, a member never sees them', async ({ page }) => {
  const admin = await newPerson('Ada Account', 'admin')
  await signInWithTotp(page.request, admin)
  const org = admin.organizationSlug
  await page.goto(`/${org}/account`)
  await expect(page.getByRole('heading', { name: 'Account social', level: 1 })).toBeVisible()

  const member = await addPerson(org, 'Mario Membro', 'member')
  await page.context().clearCookies()
  await signIn(page.request, member)
  await page.goto(`/${org}`)
  await expect(page.getByRole('link', { name: 'Account social' })).toHaveCount(0)
  await page.goto(`/${org}/account`)
  await expect(page.getByRole('heading', { name: 'Pagina non trovata' })).toBeVisible()
})

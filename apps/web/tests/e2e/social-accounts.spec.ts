import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { META_MOCK } from '@app/meta-mock'
import { connectedAgency, metaApp } from './support/meta.ts'
import {
  E2E_PASSWORD,
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

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

const meta = (org: string) => `/${org}/impostazioni/integrazioni/meta`

/** A calendar day `days` from now in the panel's time zone, where the reminder counts days. */
const dayFromNow = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(
    new Date(Date.now() + days * 86_400_000),
  )

test('social accounts: empty before anything is connected', async ({ page }) => {
  const owner = await newPerson('Olga Vuota', 'owner')
  await signInWithTotp(page.request, owner)
  await page.goto(`/${owner.organizationSlug}/impostazioni/integrazioni/meta`)
  await expect(page.getByRole('heading', { name: 'Meta', exact: true, level: 2 })).toBeVisible()
  await expect(page.getByText('Nessun account collegato')).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
})

test('social accounts: profiles, reminders, sync and a new token', async ({ page }) => {
  const owner = await newPerson('Olga Account', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org, { dataUseCheckupDueOn: dayFromNow(10) })

  await page.goto(meta(org))
  const list = page.getByRole('table', { name: 'Profili' })
  // a row for each account, the page and its Instagram; not checked yet (no worker)
  await expect(list.getByTestId(`account-${META_MOCK.pages.withInstagram}`)).toContainText(
    'Forno Luce',
  )
  await expect(list.getByTestId(`account-${META_MOCK.instagram.ofPage}`)).toContainText(
    'Da controllare',
  )
  await expect(list).toContainText('Non assegnato a nessun cliente')

  const reminders = page.getByRole('region', { name: 'Da sistemare su Meta' })
  await expect(reminders).toContainText("Il Data Use Checkup dell'app Meta scade il")
  await expect(reminders).toContainText('tra 10 giorni')

  const connections = page.getByRole('region', { name: 'Collegamenti' })
  // the Business of the system user is the row's name, the kind goes under it (B11)
  await expect(connections).toContainText('Agenzia Demo')
  await expect(connections).toContainText('Utente di sistema Meta ·')
  await page.screenshot({ path: test.info().outputPath('collegamenti.png'), fullPage: true })
  const sync = connections.getByRole('button', { name: 'Sincronizza' })
  // a second tab opened before the sync still offers it: the server says it is too soon
  const other = await page.context().newPage()
  await other.goto(meta(org))
  const otherConnections = other.getByRole('region', { name: 'Collegamenti' })
  const otherSync = otherConnections.getByRole('button', { name: 'Sincronizza' })
  await expect(otherSync).toBeEnabled()
  await sync.click()
  await expect(connections.getByRole('status')).toContainText('Sincronizzazione avviata')
  // one sync every 5 minutes: the button waits too, and says for how long
  // the countdown is not in the live region: it would be read again every minute
  await expect(connections).toContainText('Puoi sincronizzare di nuovo tra 5 minuti')
  await expect(connections.getByRole('status')).not.toContainText('Puoi sincronizzare')
  await expect(sync).toBeDisabled()
  await otherSync.click()
  await expect(otherConnections.getByRole('status')).toContainText('Hai già sincronizzato')
  await expect(otherConnections).toContainText(/Puoi sincronizzare di nuovo tra [1-5] minut/)
  await expect(otherSync).toBeDisabled()
  await other.close()
  // a page opened again reads the wait from the server, before any click
  await page.reload()
  await expect(connections).toContainText(/Puoi sincronizzare di nuovo tra [1-5] minut/)
  await expect(sync).toBeDisabled()

  await connections.getByRole('button', { name: 'Azioni per Agenzia Demo' }).click()
  await page.getByRole('menuitem', { name: 'Sostituisci token' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sostituisci token' })
  await dialog.getByLabel("Token dell'utente di sistema").fill(META_MOCK.tokens.systemUser)
  await dialog.getByRole('button', { name: 'Verifica e salva' }).click()
  // the reauth of the setup is recent: no "Conferma che sei tu"
  await expect(page.getByText('Token sostituito: il collegamento funziona di nuovo.')).toBeVisible()
  // the window has closed, its fading out would read as faint text
  await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(0)
  expect((await axe(page)).violations).toEqual([])
})

test('social accounts: a system user without accounts yet is listed as waiting', async ({
  page,
}) => {
  const owner = await newPerson('Olga Attesa', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org, { importAccounts: false })
  // a Business name Meta did not give (none, or more than one): the row reads as before B11
  await adminQuery(
    'update account_connections set business_name = null where organization_id = $1',
    [org],
  )
  await page.goto(meta(org))
  const connections = page.getByRole('region', { name: 'Collegamenti' })
  await expect(connections).toContainText('Utente di sistema Meta')
  await expect(connections).not.toContainText('Agenzia Demo')
  await expect(
    connections.getByRole('button', { name: 'Azioni per Utente di sistema Meta' }),
  ).toBeVisible()
  await expect(connections).toContainText('in attesa dei primi account')
  await expect(page.getByText('Nessun account collegato')).toBeVisible()
})

test('social accounts: an inactive account says why, and a dead token says it plainly', async ({
  page,
}) => {
  const owner = await newPerson('Olga Inattivo', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)
  const [total] = await adminQuery<{ n: number }>(
    'select count(*)::int as n from social_accounts where organization_id = $1',
    [org],
  )
  // Meta no longer hands the agency's own Instagram to the system user
  await adminQuery(
    "update social_accounts set active = false where organization_id = $1 and external_id = $2 and platform = 'instagram'",
    [org, META_MOCK.instagram.agencyOnly],
  )

  await page.goto(meta(org))
  const connections = page.getByRole('region', { name: 'Collegamenti' })
  // only the active accounts count; the inactive one is named apart
  await expect(connections).toContainText(`${String((total?.n ?? 0) - 1)} · 1 inattivo`)
  const inactive = page.getByTestId(`account-${META_MOCK.instagram.agencyOnly}`)
  await expect(inactive).toContainText('Inattivo')
  await expect(inactive).toContainText("Non è più assegnato all'utente di sistema su Meta")
  await expect(inactive.getByRole('link', { name: 'Cerca nuovi account' })).toHaveAttribute(
    'href',
    `/${org}/impostazioni/integrazioni/meta/aggiungi`,
  )

  // a revoked token answers like an expired one (190): the text does not guess which
  await adminQuery("update account_connections set status = 'expired' where organization_id = $1", [
    org,
  ])
  await page.reload()
  await expect(connections).toContainText('il token non vale più (revocato o scaduto): ricollega')
  // a dead connection cannot find it again: no advice that leads nowhere
  await expect(inactive).toContainText('Meta non lo dà più a questo collegamento')
  await expect(inactive.getByRole('link', { name: 'Cerca nuovi account' })).toHaveCount(0)
  await expect(connections).not.toContainText('token scaduto')
  expect((await axe(page)).violations).toEqual([])
})

test('social accounts: an admin connects and syncs from Integrazioni, a member never sees them', async ({
  page,
}) => {
  const owner = await newPerson('Olga Prepara', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await metaApp(page.request, org)
  const admin = await addPerson(org, 'Ada Account', 'admin')
  await page.context().clearCookies()
  await signInWithTotp(page.request, admin)

  await page.goto(`/${org}/impostazioni/integrazioni`)
  await page.getByRole('link', { name: /Meta/ }).click()
  await expect(page.getByRole('heading', { name: 'Profili', level: 2 })).toBeVisible()
  await page.getByRole('link', { name: 'Aggiungi account' }).first().click()
  await expect(page).toHaveURL(new RegExp(`/${org}/impostazioni/integrazioni/meta/aggiungi$`))
  await page.getByRole('radio', { name: /Sì, è nel Business Manager dell'agenzia/ }).check()
  await page.getByRole('button', { name: "Collega l'utente di sistema" }).click()
  const dialog = page.getByRole('dialog', { name: "Collega l'utente di sistema" })
  await dialog.getByLabel("Token dell'utente di sistema").fill(META_MOCK.tokens.systemUser)
  await dialog.getByRole('button', { name: 'Verifica e salva' }).click()
  // a sign-in a moment ago may count as a recent confirmation
  const reauth = page.getByRole('dialog', { name: 'Conferma che sei tu' })
  const found = page.getByRole('heading', { name: /Abbiamo trovato \d+ profili/ })
  await expect(found.or(reauth)).toBeVisible()
  if (await reauth.isVisible()) {
    await reauth.getByLabel('Password').fill(E2E_PASSWORD)
    await reauth.getByRole('button', { name: 'Conferma' }).click()
  }
  await expect(found).toBeVisible()

  await page.getByRole('link', { name: 'Torna a Meta' }).click()
  const connections = page.getByRole('region', { name: 'Collegamenti' })
  await expect(connections).toContainText('Utente di sistema Meta')
  await connections.getByRole('button', { name: 'Sincronizza' }).click()
  await expect(connections.getByRole('status')).toContainText('Sincronizzazione avviata')
  // the app is the Owner's: the Admin reads it
  await expect(page.getByRole('region', { name: 'App Meta' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sostituisci', exact: true })).toHaveCount(0)
  expect((await axe(page)).violations).toEqual([])

  const member = await addPerson(org, 'Mario Membro', 'member')
  await page.context().clearCookies()
  await signIn(page.request, member)
  await page.goto(`/${org}`)
  await expect(page.getByRole('link', { name: 'Integrazioni' })).toHaveCount(0)
  await page.goto(meta(org))
  await expect(page.getByRole('heading', { name: 'Pagina non trovata' })).toBeVisible()
  await page.goto(`${meta(org)}/aggiungi`)
  await expect(page.getByRole('heading', { name: 'Pagina non trovata' })).toBeVisible()
})

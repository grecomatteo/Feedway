import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { assignAccount, connectedAgency, newWorkspace } from './support/meta.ts'
import {
  addPerson,
  adminQuery,
  newPerson,
  ownAddress,
  signIn,
  signInWithTotp,
} from './support/people.ts'

// «Clienti» in the union style (plan 04 Task 5b, spec §14.7): the clients with their profiles,
// the state of the link only where someone has to act, filter, search and «⋯».

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768
/** The table on a computer, the rows on a phone: the one that shows. */
const clients = (page: Page) =>
  page.getByRole('table', { name: 'Clienti' }).or(page.getByRole('list', { name: 'Clienti' }))
const rowOf = (page: Page, name: string) =>
  clients(page)
    .locator(isPhone(page) ? 'li' : 'tr')
    .filter({ has: page.getByRole('link', { name, exact: true }) })

async function fitsTheScreen(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

/** An Owner, the agency connected to the mock, two clients with their profiles and one without. */
async function agencyWithClients(page: Page) {
  const owner = await newPerson('Olga Clienti', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)
  const accounts = await adminQuery<{ id: string; name: string; platform: string }>(
    'select id, name, platform from social_accounts where organization_id = $1',
    [org],
  )
  const idsOf = (name: string) => accounts.filter((a) => a.name === name).map((a) => a.id)
  const forno = await newWorkspace(page.request, org, 'Forno Luce')
  const bottega = await newWorkspace(page.request, org, 'Bottega')
  await newWorkspace(page.request, org, 'Studio Riva')
  for (const id of idsOf('Forno Luce')) await assignAccount(page.request, org, forno.id, id)
  for (const id of idsOf('Bottega Verde')) await assignAccount(page.request, org, bottega.id, id)
  return { owner, org, forno, bottega }
}

test('the clients with their profiles, the summary, search and the archived ones', async ({
  page,
}) => {
  const { org } = await agencyWithClients(page)
  await page.goto(`/${org}/spazi`)
  await expect(page.locator('[data-ready]')).toHaveCount(1)

  await expect(page.getByRole('heading', { level: 1, name: 'Clienti' })).toBeVisible()
  await expect(page.getByRole('main').locator('header p').first()).toHaveText('3 clienti.')
  // the profile is its Instagram and its Page; a client without one says so
  await expect(rowOf(page, 'Forno Luce')).toContainText('@fornoluce')
  await expect(rowOf(page, 'Bottega')).toContainText('Bottega Verde')
  await expect(rowOf(page, 'Studio Riva')).toContainText('Nessun profilo')
  // all is well: no state is written
  await expect(clients(page).locator('[data-tone]')).toHaveCount(0)
  if (!isPhone(page))
    await expect(clients(page).getByRole('columnheader')).toHaveText([
      'Cliente',
      'Profili',
      'Collegamento',
      'Azioni',
    ])
  await fitsTheScreen(page)
  expect((await axe(page)).violations).toEqual([])

  // the search finds a client by its name or by a profile's
  const search = page.getByRole('searchbox', { name: 'Cerca un cliente o un profilo' })
  await search.fill('@fornoluce')
  await expect(clients(page).getByRole('link')).toHaveText(['Forno Luce'])
  await search.fill('verde')
  await expect(clients(page).getByRole('link')).toHaveText(['Bottega'])
  await search.fill('nessuno')
  await expect(page.getByText('Nessun cliente trovato per «nessuno».')).toBeVisible()
  // a client created during a search shows: the search empties
  await page.getByRole('button', { name: 'Nuovo cliente' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nuovo cliente' })
  await dialog.getByLabel('Nome del nuovo cliente').fill('Ottica Bellavista')
  await dialog.getByRole('button', { name: 'Crea', exact: true }).click()
  await expect(rowOf(page, 'Ottica Bellavista')).toBeVisible()
  await expect(search).toHaveValue('')

  // «⋯» → Archivia: the client moves to «Archiviati»
  await rowOf(page, 'Studio Riva').getByRole('button', { name: 'Azioni per Studio Riva' }).click()
  await expect(page.getByRole('menuitem')).toHaveText(['Apri', 'Persone', 'Rinomina', 'Archivia'])
  await page.getByRole('menuitem', { name: 'Archivia' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Archivia' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Studio Riva archiviato.' }),
  ).toBeVisible()
  await expect(page.getByRole('main').locator('header p').first()).toHaveText('3 clienti.')
  const filter = page.getByRole('group', { name: 'Mostra' })
  await filter.getByRole('button', { name: 'Archiviati 1' }).click()
  await expect(clients(page).getByRole('link')).toHaveText(['Studio Riva'])
  await rowOf(page, 'Studio Riva').getByRole('button', { name: 'Azioni per Studio Riva' }).click()
  await expect(page.getByRole('menuitem')).toHaveText(['Apri', 'Persone'])
})

test('a profile to reconnect: the summary links to the client, «Ricollega» for the Owner', async ({
  page,
}) => {
  const { org } = await agencyWithClients(page)
  await adminQuery(`update account_connections set status = 'expired' where organization_id = $1`, [
    org,
  ])
  await page.goto(`/${org}/spazi`)
  await expect(page.locator('[data-ready]')).toHaveCount(1)

  const summary = page.getByRole('main').locator('header p').first()
  await expect(summary).toHaveText('3 clienti. Bottega ha un profilo da ricollegare.')
  await expect(summary.getByRole('link', { name: 'Bottega' })).toHaveAttribute(
    'href',
    /\/spazi\/bottega[^/]*$/,
  )
  await expect(rowOf(page, 'Forno Luce').getByText('Da ricollegare')).toBeVisible()
  await expect(rowOf(page, 'Studio Riva').locator('[data-tone]')).toHaveCount(0)
  await fitsTheScreen(page)
  expect((await axe(page)).violations).toEqual([])
  // the state does not hide the profiles
  await expect(rowOf(page, 'Forno Luce')).toContainText('@fornoluce')
  if (isPhone(page)) {
    // no room for the button: «Ricollega» comes first in «⋯»
    await rowOf(page, 'Forno Luce').getByRole('button', { name: 'Azioni per Forno Luce' }).click()
    await expect(page.getByRole('menuitem').first()).toHaveText('Ricollega')
    await page.getByRole('menuitem', { name: 'Ricollega' }).click()
    await expect(page).toHaveURL(new RegExp(`/${org}/impostazioni/integrazioni$`))
  } else {
    await expect(
      rowOf(page, 'Forno Luce').getByRole('link', { name: 'Ricollega i profili di Forno Luce' }),
    ).toHaveAttribute('href', `/${org}/impostazioni/integrazioni`)
    // the button is enough: the menu does not repeat it
    await rowOf(page, 'Forno Luce').getByRole('button', { name: 'Azioni per Forno Luce' }).click()
    await expect(page.getByRole('menuitem', { name: 'Ricollega' })).toBeHidden()
  }
})

test('a Member sees only their client and its state, without «Ricollega» or changes', async ({
  page,
  browser,
  baseURL,
}) => {
  const { org, forno } = await agencyWithClients(page)
  await adminQuery(`update account_connections set status = 'expired' where organization_id = $1`, [
    org,
  ])
  const editor = await addPerson(org, 'Elsa Editor', 'member', [
    { workspaceId: forno.id, role: 'editor' },
  ])
  const other = await browser.newContext({ baseURL: baseURL ?? '' })
  try {
    const p = await other.newPage()
    await ownAddress(p)
    await signIn(p.request, editor)
    await p.goto(`/${org}/spazi`)
    await expect(p.locator('[data-ready]')).toHaveCount(1)
    await expect(clients(p).getByRole('link')).toHaveText(['Forno Luce'])
    await expect(rowOf(p, 'Forno Luce')).toContainText('Da ricollegare')
    await expect(p.getByText('Bottega Verde')).toHaveCount(0)
    await expect(p.getByRole('link', { name: /Ricollega/ })).toHaveCount(0)
    await expect(p.getByRole('button', { name: 'Nuovo cliente' })).toHaveCount(0)
    await rowOf(p, 'Forno Luce').getByRole('button', { name: 'Azioni per Forno Luce' }).click()
    await expect(p.getByRole('menuitem')).toHaveText(['Apri'])
  } finally {
    await other.close()
  }
})

test('while the clients load, the shape of their rows', async ({ page }) => {
  const owner = await newPerson('Olga Attesa', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  let release = () => {}
  const held = new Promise<void>((r) => (release = r))
  await page.route(`**/api/v1/orgs/${org}/workspaces`, async (route) => {
    await held
    await route.continue()
  })
  await page.goto(`/${org}/spazi`)
  const loading = page.getByRole('status').filter({ hasText: 'Carico i clienti…' })
  await expect(loading).toBeAttached()
  await expect(page.locator('[data-skeleton-row]').filter({ visible: true }).first()).toBeVisible()
  release()
  await expect(loading).toHaveCount(0)
  await expect(page.getByText('Nessun cliente per ora.')).toBeVisible()
})

test('«Nuovo cliente» opens a dialog and the client joins the list', async ({ page }) => {
  const owner = await newPerson('Olga Nuova', 'owner')
  await signInWithTotp(page.request, owner)
  await page.goto(`/${owner.organizationSlug}/spazi`)
  await expect(page.locator('[data-ready]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Nuovo cliente' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nuovo cliente' })
  await dialog.getByLabel('Nome del nuovo cliente').fill('Gelateria Nuvola')
  await dialog.getByRole('button', { name: 'Crea', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(rowOf(page, 'Gelateria Nuvola')).toContainText('Nessun profilo')
  await expect(page.getByRole('main').locator('header p').first()).toHaveText('1 cliente.')

  await rowOf(page, 'Gelateria Nuvola')
    .getByRole('button', { name: 'Azioni per Gelateria Nuvola' })
    .click()
  await page.getByRole('menuitem', { name: 'Rinomina' }).click()
  const rename = page.getByRole('dialog', { name: 'Rinomina Gelateria Nuvola' })
  await rename.getByLabel('Nuovo nome').fill('Gelateria Aurora')
  await rename.getByRole('button', { name: 'Salva' }).click()
  await expect(rowOf(page, 'Gelateria Aurora')).toBeVisible()
})

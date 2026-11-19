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

// «Clienti» of the new direction (screen 14, redesign R4, spec §14.7): the clients with their
// profiles, next post and posts planned, the state of the link only where someone has to act,
// filter, search and «⋯».

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768
/** The list of the clients: a table, whose head a phone hides. */
const clients = (page: Page) => page.getByRole('table', { name: 'Clienti' })
const rowOf = (page: Page, name: string) =>
  clients(page)
    .getByRole('row')
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
  // no sentence under the title (D-81)
  await expect(page.locator('[data-page-summary]')).toHaveCount(0)
  // the profile is its Instagram and its Page; a client without one says so (the profiles'
  // column is on a computer: a phone shows them on the client's page)
  if (!isPhone(page)) {
    await expect(rowOf(page, 'Forno Luce')).toContainText('@fornoluce', { useInnerText: true })
    await expect(rowOf(page, 'Bottega')).toContainText('Bottega Verde', { useInnerText: true })
    await expect(rowOf(page, 'Studio Riva')).toContainText('Nessun profilo', {
      useInnerText: true,
    })
  }
  // all is well: no state is written
  await expect(clients(page).locator('[data-tone]')).toHaveCount(0)
  if (!isPhone(page))
    await expect(clients(page).getByRole('columnheader')).toHaveText([
      'Cliente',
      'Profili',
      'Prossimo post',
      'In programma',
      'Collegamento',
      'Azioni',
    ])
  // nothing planned yet: a dash on a computer, a sentence on a phone
  await expect(rowOf(page, 'Forno Luce')).toContainText(
    isPhone(page) ? 'Nessun post in programma' : '—',
    { useInnerText: true },
  )
  if (!isPhone(page))
    await expect(rowOf(page, 'Forno Luce')).not.toContainText('Nessun post in programma', {
      useInnerText: true,
    })
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
  await dialog.getByLabel('Nome').fill('Ottica Bellavista')
  await dialog.getByRole('button', { name: 'Crea cliente' }).click()
  await expect(rowOf(page, 'Ottica Bellavista')).toBeVisible()
  await expect(search).toHaveValue('')

  // «⋯» → Archivia: the client moves to «Archiviati»
  await rowOf(page, 'Studio Riva').getByRole('button', { name: 'Azioni per Studio Riva' }).click()
  await expect(page.getByRole('menuitem')).toHaveText(['Apri', 'Persone', 'Rinomina', 'Archivia'])
  await page.getByRole('menuitem', { name: 'Archivia' }).click()
  // no scheduled post: the dialog does not speak of posts going back to draft (D-70)
  await expect(page.getByRole('dialog')).toContainText('Il cliente resta leggibile')
  await expect(page.getByRole('dialog')).not.toContainText('tornano in bozza')
  await page.getByRole('dialog').getByRole('button', { name: 'Archivia' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Studio Riva archiviato.' }),
  ).toBeVisible()
  const filter = page.getByRole('group', { name: 'Mostra' })
  await filter.getByRole('button', { name: 'Archiviati 1' }).click()
  await expect(clients(page).getByRole('link')).toHaveText(['Studio Riva'])
  await rowOf(page, 'Studio Riva').getByRole('button', { name: 'Azioni per Studio Riva' }).click()
  await expect(page.getByRole('menuitem')).toHaveText(['Apri', 'Persone'])
})

test('a profile to reconnect: the row says it, «Ricollega» in «⋯» for the Owner', async ({
  page,
}) => {
  const { org } = await agencyWithClients(page)
  await adminQuery(`update account_connections set status = 'expired' where organization_id = $1`, [
    org,
  ])
  await page.goto(`/${org}/spazi`)
  await expect(page.locator('[data-ready]')).toHaveCount(1)

  await expect(rowOf(page, 'Forno Luce').getByText('Da ricollegare')).toBeVisible()
  await expect(rowOf(page, 'Bottega').getByText('Da ricollegare')).toBeVisible()
  await expect(rowOf(page, 'Studio Riva').locator('[data-tone]')).toHaveCount(0)
  await fitsTheScreen(page)
  expect((await axe(page)).violations).toEqual([])
  // the state does not hide the profiles (on a phone they are on the client's page)
  if (!isPhone(page))
    await expect(rowOf(page, 'Forno Luce')).toContainText('@fornoluce', { useInnerText: true })
  // «Ricollega» is the first action of «⋯», where it is the thing to do
  await rowOf(page, 'Forno Luce').getByRole('button', { name: 'Azioni per Forno Luce' }).click()
  await expect(page.getByRole('menuitem').first()).toHaveText('Ricollega')
  await page.getByRole('menuitem', { name: 'Ricollega' }).click()
  await expect(page).toHaveURL(new RegExp(`/${org}/impostazioni/integrazioni/meta$`))
})

test('the next post and how many are planned, only for what is still to come', async ({ page }) => {
  const { org, forno } = await agencyWithClients(page)
  const now = new Date()
  // three scheduled posts of Forno Luce: in two hours, in three days, and one already gone
  for (const hours of [2, 72, -5]) {
    const res = await page.request.post(`/api/v1/orgs/${org}/workspaces/${forno.id}/posts`, {
      headers: { origin: new URL(process.env.E2E_BASE_URL ?? '').origin, 'x-app-request': '1' },
      data: { type: 'photo', caption: { common: 'Prova' }, mediaIds: [], destinations: [] },
    })
    expect(res.status()).toBeLessThan(300)
    const { id } = (await res.json()) as { id: string }
    await adminQuery(
      `update posts set status = 'scheduled', scheduled_by = created_by, scheduled_at = $2
        where id = $1`,
      [id, new Date(now.getTime() + hours * 3_600_000).toISOString()],
    )
  }
  await page.goto(`/${org}/spazi`)
  await expect(page.locator('[data-ready]')).toHaveCount(1)
  const row = rowOf(page, 'Forno Luce')
  if (isPhone(page)) {
    await expect(row).toContainText(/Prossimo: (oggi|domani), \d{1,2}:\d{2}/, {
      useInnerText: true,
    })
  } else {
    await expect(row.getByRole('cell').nth(2)).toHaveText(/^(oggi|domani), \d{1,2}:\d{2}$/)
    await expect(row.getByRole('cell').nth(3)).toHaveText('2 post')
    await expect(rowOf(page, 'Bottega').getByRole('cell').nth(3)).toHaveText('—')
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
  await dialog.getByLabel('Nome').fill('Gelateria Nuvola')
  await dialog.getByRole('button', { name: 'Crea cliente' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByRole('status').filter({ hasText: 'Gelateria Nuvola creato.' }),
  ).toBeVisible()
  if (!isPhone(page))
    await expect(rowOf(page, 'Gelateria Nuvola')).toContainText('Nessun profilo', {
      useInnerText: true,
    })

  await rowOf(page, 'Gelateria Nuvola')
    .getByRole('button', { name: 'Azioni per Gelateria Nuvola' })
    .click()
  await page.getByRole('menuitem', { name: 'Rinomina' }).click()
  const rename = page.getByRole('dialog', { name: 'Rinomina Gelateria Nuvola' })
  await rename.getByLabel('Nuovo nome').fill('Gelateria Aurora')
  await rename.getByRole('button', { name: 'Salva' }).click()
  await expect(rowOf(page, 'Gelateria Aurora')).toBeVisible()
})

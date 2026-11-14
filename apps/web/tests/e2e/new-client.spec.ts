import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { connectedAgency, newWorkspace } from './support/meta.ts'
import { addPerson, newPerson, ownAddress, signIn, signInWithTotp } from './support/people.ts'

// Clients born from their profiles (plan 04 Task 5c, spec §14.7): «Abbina ai clienti» after a
// connection, «Nuovo cliente» from a profile, «Sistemali» and the «Annulla» of «Crea N clienti».

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768
const clients = (page: Page) =>
  page.getByRole('table', { name: 'Clienti' }).or(page.getByRole('list', { name: 'Clienti' }))
const proposals = (page: Page) =>
  page
    .getByRole('table', { name: 'Clienti da creare' })
    .or(page.getByRole('list', { name: 'Clienti da creare' }))
const proposalOf = (page: Page, name: string) =>
  proposals(page)
    .locator(isPhone(page) ? 'li' : 'tr')
    .filter({
      has: page.getByRole(isPhone(page) ? 'switch' : 'checkbox', {
        name: `Crea il cliente ${name}`,
      }),
    })

async function fitsTheScreen(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

/** Renames a proposed client: the field on a computer, the sheet of the row on a phone. */
async function rename(page: Page, from: string, to: string) {
  if (isPhone(page)) {
    await page.getByRole('button', { name: `Cliente ${from}` }).click()
    const sheet = page.getByRole('dialog', { name: `Cliente ${from}` })
    await sheet.getByLabel('Cliente da creare').fill(to)
    await sheet.getByRole('button', { name: 'Fatto' }).click()
    await expect(sheet).toHaveCount(0)
  } else {
    await proposalOf(page, from).getByRole('textbox').fill(to)
  }
}

async function openMerge(page: Page, name: string) {
  if (isPhone(page)) {
    await page.getByRole('button', { name: `Cliente ${name}` }).click()
    await page.getByRole('button', { name: 'Unisci con un altro profilo…' }).click()
  } else {
    await proposalOf(page, name)
      .getByRole('button', { name: `Azioni per ${name}` })
      .click()
    await page.getByRole('menuitem', { name: 'Unisci con…' }).click()
  }
}

test('«Abbina ai clienti»: untick, rename, join two rows, «Crea N clienti» and «Annulla»', async ({
  page,
}) => {
  const owner = await newPerson('Olga Abbina', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org, { importAccounts: false })

  await page.goto(`/${org}/account/aggiungi`)
  await page.getByRole('radio', { name: /Sì, è nel Business Manager dell'agenzia/ }).check()
  await page.getByRole('button', { name: 'Cerca nuovi account' }).click()
  // the proposals come below the guide: the page takes the person to them
  await expect(page.getByRole('heading', { name: /Abbiamo trovato \d+ profili/ })).toBeFocused()
  await expect(page.getByRole('heading', { name: /Abbiamo trovato \d+ profili/ })).toBeInViewport()
  // Instagram and its Page on Meta are one row; an Instagram alone is a client of its own
  await expect(proposalOf(page, 'Forno Luce')).toBeVisible()
  await expect(proposalOf(page, 'Studio Rossi')).toBeVisible()
  if (!isPhone(page)) {
    await expect(proposalOf(page, 'Forno Luce')).toContainText(
      'Instagram e Pagina collegati su Meta',
    )
    await expect(proposalOf(page, 'Studio Rossi')).toContainText('Solo Instagram')
  }
  await fitsTheScreen(page)
  // the mouse leaves the button it pressed: axe measures the page, not a hover
  await page.mouse.move(0, 0)
  expect((await axe(page)).violations).toEqual([])

  if (!isPhone(page)) {
    await proposalOf(page, 'Caffè Centrale')
      .getByRole('button', { name: 'Azioni per Caffè Centrale' })
      .click()
    await page.getByRole('menuitem', { name: 'Rinomina' }).click()
    await expect(proposalOf(page, 'Caffè Centrale').getByRole('textbox')).toBeFocused()
  }
  // not a client: it stays in «Sistemali»
  const caffe = page.getByRole(isPhone(page) ? 'switch' : 'checkbox', {
    name: 'Crea il cliente Caffè Centrale',
  })
  await caffe.click()
  await expect(caffe).not.toBeChecked()
  await rename(page, 'Forno Luce', 'Panificio Luce')
  // two accounts of one client that Meta does not pair: the person joins them
  await openMerge(page, 'Studio Rossi')
  await page
    .getByRole('dialog', { name: 'Unisci Studio Rossi con…' })
    .getByRole('button', { name: /Bottega Verde/ })
    .click()
  await expect(proposalOf(page, 'Bottega Verde')).toHaveCount(0)
  await expect(page.getByText('Caffè Centrale resta in «Sistemali»')).toBeVisible()

  await page.getByRole('button', { name: 'Crea 2 clienti' }).click()
  await expect(page).toHaveURL(new RegExp(`/${org}/spazi$`))
  await expect(page.locator('[data-ready]')).toHaveCount(1)
  await expect(clients(page).getByRole('link')).toHaveText(['Panificio Luce', 'Studio Rossi'])
  await expect(page.getByText('1 profilo trovato non è in un cliente.')).toBeVisible()
  const undo = page.getByRole('status').filter({ hasText: '2 clienti creati' })
  await expect(undo).toBeVisible()
  await fitsTheScreen(page)
  expect((await axe(page)).violations).toEqual([])

  await undo.getByRole('button', { name: 'Annulla' }).click()
  await expect(
    page.getByText('Fatto: i clienti sono tolti e i profili sono in «Sistemali».'),
  ).toBeVisible()
  await expect(clients(page)).toHaveCount(0)
  await expect(page.getByText('4 profili trovati non sono in un cliente.')).toBeVisible()
})

test('«Nuovo cliente» from a profile, and without one', async ({ page }) => {
  const owner = await newPerson('Olga Profilo', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)

  await page.goto(`/${org}/spazi`)
  await expect(page.locator('[data-ready]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Nuovo cliente' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nuovo cliente' })
  await dialog.getByRole('radio', { name: /Forno Luce/ }).check()
  await expect(dialog.getByLabel('Nome del nuovo cliente')).toHaveValue('Forno Luce')
  expect((await axe(page)).violations).toEqual([])
  await dialog.getByRole('button', { name: 'Crea', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const forno = clients(page)
    .locator(isPhone(page) ? 'li' : 'tr')
    .filter({ hasText: 'Forno Luce' })
  await expect(forno).toContainText('@fornoluce')

  await page.getByRole('button', { name: 'Nuovo cliente' }).click()
  await dialog.getByRole('radio', { name: /Senza profilo, per ora/ }).check()
  await dialog.getByLabel('Nome del nuovo cliente').fill('Cantina Monteverde')
  await dialog.getByRole('button', { name: 'Crea', exact: true }).click()
  await expect(
    clients(page)
      .locator(isPhone(page) ? 'li' : 'tr')
      .filter({ hasText: 'Cantina Monteverde' }),
  ).toContainText('Nessun profilo')
})

test('«Sistemali»: create the client, or add the profile to one that exists', async ({ page }) => {
  const owner = await newPerson('Olga Sistema', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)
  await newWorkspace(page.request, org, 'Bottega')

  await page.goto(`/${org}/spazi`)
  await expect(page.locator('[data-ready]')).toHaveCount(1)
  await expect(page.getByText('4 profili trovati non sono in un cliente.')).toBeVisible()
  await page.getByRole('button', { name: 'Sistemali' }).click()
  const panel = page.getByRole('dialog', { name: 'Profili senza cliente' })
  expect((await axe(page)).violations).toEqual([])

  await panel.getByRole('button', { name: 'Aggiungi Bottega Verde a un cliente esistente' }).click()
  await page
    .getByRole('dialog', { name: 'Aggiungi Bottega Verde a…' })
    .getByRole('button', { name: 'Bottega' })
    .click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Bottega Verde aggiunto a Bottega.' }),
  ).toBeVisible()
  await expect(page.getByText('3 profili trovati non sono in un cliente.')).toBeVisible()

  await page.getByRole('button', { name: 'Sistemali' }).click()
  await panel.getByRole('button', { name: 'Crea il cliente per Studio Rossi' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nuovo cliente' })
  await expect(dialog.getByLabel('Nome del nuovo cliente')).toHaveValue('Studio Rossi')
  await dialog.getByRole('button', { name: 'Crea', exact: true }).click()
  await expect(page.getByText('2 profili trovati non sono in un cliente.')).toBeVisible()
  await expect(clients(page).getByRole('link')).toHaveText(['Bottega', 'Studio Rossi'])
  await fitsTheScreen(page)
})

test('a Member does not see «Sistemali»', async ({ page, browser, baseURL }) => {
  const owner = await newPerson('Olga Membro', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)
  const forno = await newWorkspace(page.request, org, 'Forno Luce')
  const editor = await addPerson(org, 'Elio Editor', 'member', [
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
    await expect(p.getByRole('button', { name: 'Sistemali' })).toHaveCount(0)
    await expect(p.getByText(/profili trovati/)).toHaveCount(0)
  } finally {
    await other.close()
  }
})

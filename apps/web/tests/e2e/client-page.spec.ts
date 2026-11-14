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

// The client's page (plan 04 Task 6a, spec §14.7): head, tabs, Panoramica with the profiles and
// who works in it, «Togli dal cliente» and «Sostituisci profilo» for Owner and Admin. The
// selector that opens it (D-5, D-6) is in agency.spec.ts, with the context it keeps.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
const clients = (page: Page) =>
  page.getByRole('table', { name: 'Clienti' }).or(page.getByRole('list', { name: 'Clienti' }))
/** The profiles of the Panoramica: a table on a computer, rows on a phone. */
const profiles = (page: Page) =>
  page.getByRole('table', { name: 'Profili' }).or(page.getByRole('list', { name: 'Profili' }))

async function fitsTheScreen(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

const accountId = async (org: string, name: string, platform: string) =>
  (
    await adminQuery<{ id: string }>(
      'select id from social_accounts where organization_id = $1 and name = $2 and platform = $3',
      [org, name, platform],
    )
  )[0]?.id ?? ''

/** An agency with its accounts imported and the client Forno Luce with its Page and Instagram. */
async function agencyWithClient(page: Page) {
  const owner = await newPerson('Olga Cliente', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)
  const client = await newWorkspace(page.request, org, 'Forno Luce')
  await assignAccount(page.request, org, client.id, await accountId(org, 'Forno Luce', 'facebook'))
  await assignAccount(page.request, org, client.id, await accountId(org, 'Forno Luce', 'instagram'))
  return { owner, org, client }
}

test('the client page: from Clienti, with its profiles, its tabs and the old address', async ({
  page,
}) => {
  const { org, client } = await agencyWithClient(page)
  await page.goto(`/${org}/spazi`)
  await clients(page).getByRole('link', { name: 'Forno Luce', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/${org}/spazi/${client.slug}$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Forno Luce' })).toBeVisible()
  // the names of its profiles under the name, «Nuovo post» waiting for stage 6
  await expect(page.getByRole('main').getByText('@fornoluce').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Nuovo post/ })).toBeDisabled()

  const tabs = page.getByRole('navigation', { name: 'Sezioni del cliente' })
  await expect(tabs.getByRole('link', { name: 'Panoramica' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(tabs.getByText('Calendario')).toContainText('Presto')
  await expect(tabs.getByText('Libreria')).toContainText('Presto')
  await expect(tabs.getByRole('link', { name: 'Calendario' })).toHaveCount(0)

  // one row for the Page and its Instagram, linked
  const list = profiles(page)
  await expect(list.getByText('Forno Luce', { exact: true }).first()).toBeVisible()
  await expect(list.getByText(/collegato|sincronizzato/i).first()).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Chi ci lavora' })).toBeVisible()
  await fitsTheScreen(page)
  expect((await axe(page)).violations).toEqual([])

  // Persone is a tab of the same page
  await tabs.getByRole('link', { name: 'Persone' }).click()
  await expect(page).toHaveURL(new RegExp(`/spazi/${client.slug}/membri$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Forno Luce' })).toBeVisible()
  expect((await axe(page)).violations).toEqual([])

  // «Clienti → Account» of before lands on the Panoramica
  await page.goto(`/${org}/spazi/${client.slug}/account`)
  await expect(page).toHaveURL(new RegExp(`/${org}/spazi/${client.slug}$`))
  await expect(profiles(page).getByText('Forno Luce', { exact: true }).first()).toBeVisible()
})

test('«Togli dal cliente» sends the profile to «Sistemali»; «Sostituisci profilo» swaps it', async ({
  page,
}) => {
  const { org, client } = await agencyWithClient(page)
  await page.goto(`/${org}/spazi/${client.slug}`)
  await expect(page.locator('[data-ready]')).toHaveCount(1)

  // «Sostituisci profilo»: Bottega Verde, in no client, takes the place of Forno Luce
  await profiles(page).getByRole('button', { name: 'Azioni per Forno Luce' }).click()
  await page.getByRole('menuitem', { name: 'Sostituisci profilo' }).click()
  const picker = page.getByRole('dialog', { name: 'Sostituisci Forno Luce con…' })
  await picker.getByRole('radio', { name: /Bottega Verde/ }).check()
  await picker.getByRole('button', { name: 'Sostituisci profilo' }).click()
  await expect(picker).toHaveCount(0)
  await expect(page.getByText('Bottega Verde ha preso il posto di Forno Luce.')).toBeVisible()
  await expect(profiles(page).getByText('Bottega Verde', { exact: true }).first()).toBeVisible()
  await expect(profiles(page).getByText('Forno Luce', { exact: true })).toHaveCount(0)

  // «Togli dal cliente»: the account stays, and «Sistemali» counts it
  await profiles(page).getByRole('button', { name: 'Azioni per Bottega Verde' }).click()
  await page.getByRole('menuitem', { name: 'Togli dal cliente' }).click()
  const ask = page.getByRole('dialog', { name: 'Togliere Bottega Verde da Forno Luce?' })
  await expect(ask).toContainText('Sistemali')
  expect((await axe(page)).violations).toEqual([])
  await ask.getByRole('button', { name: 'Togli dal cliente' }).click()
  await expect(page.getByText('Questo cliente non ha ancora profili')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Aggiungi profilo' })).toBeVisible()

  await page.goto(`/${org}/spazi`)
  await page.getByRole('button', { name: 'Sistemali' }).click()
  const fix = page.getByRole('dialog', { name: 'Profili senza cliente' })
  await expect(fix.getByText('Bottega Verde', { exact: true }).first()).toBeVisible()
  await expect(fix.getByText('Forno Luce', { exact: true }).first()).toBeVisible()
})

test('who is not Owner or Admin sees the profiles and the people, without the actions', async ({
  page,
}) => {
  const { org, client } = await agencyWithClient(page)
  const viewer = await addPerson(org, 'Vera Vede', 'member', [
    { workspaceId: client.id, role: 'viewer' },
  ])
  await page.context().clearCookies()
  await signIn(page.request, viewer)
  await page.goto(`/${org}/spazi/${client.slug}`)
  await expect(profiles(page).getByText('Forno Luce', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Azioni per/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Aggiungi profilo' })).toHaveCount(0)
  const people = page.getByRole('list', { name: 'Chi ci lavora' })
  await expect(people.getByText('Vera Vede')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Gestisci le persone' })).toHaveCount(0)
  expect((await axe(page)).violations).toEqual([])

  await page
    .getByRole('navigation', { name: 'Sezioni del cliente' })
    .getByRole('link', { name: 'Persone' })
    .click()
  await expect(page.getByRole('list', { name: 'Persone del cliente' })).toContainText('Vera Vede')
  await expect(page.getByRole('combobox', { name: /Ruolo di/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Togli/ })).toHaveCount(0)

  // a client they do not see looks like one that does not exist
  const other = await adminQuery<{ slug: string }>(
    "insert into workspaces (id, organization_id, name, slug) select gen_random_uuid(), id, 'Riservato', 'riservato' from organizations where slug = $1 returning slug",
    [org],
  )
  await page.goto(`/${org}/spazi/${other[0]?.slug ?? ''}`)
  await expect(page.getByRole('alert')).toContainText('Questo cliente non esiste o non lo vedi.')
  const hidden = await page.getByRole('main').innerText()
  await page.goto(`/${org}/spazi/non-esiste`)
  await expect(page.getByRole('alert')).toContainText('Questo cliente non esiste o non lo vedi.')
  expect(await page.getByRole('main').innerText()).toBe(hidden)
})

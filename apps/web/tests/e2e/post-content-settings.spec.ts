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

// Labels, templates, account groups and notes (plan 06 Task 7, spec §11.7; design E8, E8c, E1):
// a Manager sets them up in «Impostazioni dei contenuti», an Editor uses them in the editor and
// adds a note; the default time shows in a new post; axe on both pages.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

const accountId = async (org: string, name: string, platform: string) =>
  (
    await adminQuery<{ id: string }>(
      'select id from social_accounts where organization_id = $1 and name = $2 and platform = $3',
      [org, name, platform],
    )
  )[0]?.id ?? ''

test('a Manager sets up labels, a template and a group; an Editor uses them and adds a note', async ({
  page,
  browser,
}) => {
  const owner = await newPerson('Olga Contenuti', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  const { connectionId } = await connectedAgency(page.request, org)
  const client = await newWorkspace(page.request, org, 'Forno Luce')
  const ig = await accountId(org, 'Forno Luce', 'instagram')
  const fb = await accountId(org, 'Forno Luce', 'facebook')
  await assignAccount(page.request, org, client.id, fb)
  await assignAccount(page.request, org, client.id, ig)
  // «Gruppi» stands above the accounts from six up (plan R7): four more Pages of the client
  for (const n of [1, 2, 3, 4]) {
    const externalId = String(Math.floor(Math.random() * 1e15))
    const [row] = await adminQuery<{ id: string }>(
      `insert into social_accounts (id, organization_id, platform, external_id, name, page_id,
                                    connection_id, health)
       values (gen_random_uuid(), $1, 'facebook', $2, $3, $2, $4, 'ok') returning id`,
      [org, externalId, `Forno Luce ${String(n)}`, connectionId],
    )
    await adminQuery(
      'insert into workspace_accounts (organization_id, workspace_id, account_id) values ($1, $2, $3)',
      [org, client.id, row?.id],
    )
  }
  await adminQuery("update social_accounts set health = 'ok' where organization_id = $1", [org])
  const manager = await addPerson(org, 'Marta Manager', 'member', [
    { workspaceId: client.id, role: 'manager' },
  ])
  const editor = await addPerson(org, 'Elia Editor', 'member', [
    { workspaceId: client.id, role: 'editor' },
  ])

  // ---- the Manager, in the client's content settings
  const mctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? '' })
  const m = await mctx.newPage()
  await ownAddress(m)
  await signIn(m.request, manager)
  await m.goto(`/${org}/spazi/${client.slug}`)
  await m.getByRole('link', { name: 'Contenuti', exact: true }).click()
  await expect(m).toHaveURL(/\/contenuti$/)
  await expect(m.getByText('Ancora nessuna etichetta')).toBeVisible()
  // a Manager cannot read the agency's settings: no zone is named, rather than a wrong one
  await expect(m.getByText(/nel fuso dell'agenzia/)).toBeVisible()
  expect((await axe(m)).violations).toEqual([])

  // the time is a choice of its own, saved as soon as it is picked
  await m.getByRole('combobox', { name: 'I nuovi post partono da' }).click()
  await m.getByRole('option', { name: '9:30', exact: true }).click()
  await expect(m.getByRole('status').filter({ hasText: 'Salvato' })).toBeVisible()

  await m.getByRole('button', { name: 'Nuova etichetta' }).click()
  const labelDialog = m.getByRole('dialog', { name: 'Nuova etichetta' })
  await labelDialog.getByLabel('Nome').fill('Natale')
  await labelDialog.getByText('Verde').click()
  await labelDialog.getByRole('button', { name: 'Crea etichetta' }).click()
  await expect(m.getByRole('list', { name: 'Etichette' }).getByText('Natale')).toBeVisible()

  await m.getByRole('button', { name: 'Nuovo modello' }).click()
  const templateDialog = m.getByRole('dialog', { name: 'Nuovo modello' })
  await templateDialog.getByText('Firma', { exact: true }).click()
  await templateDialog.getByLabel('Nome').fill('Firma del forno')
  await templateDialog.getByLabel('Testo del modello').fill('Forno Luce · via Garibaldi 12')
  await templateDialog.getByRole('button', { name: 'Crea modello' }).click()
  await expect(m.getByRole('list', { name: 'Modelli' }).getByText('Firma del forno')).toBeVisible()

  await m.getByRole('button', { name: 'Nuovo gruppo' }).click()
  const groupDialog = m.getByRole('dialog', { name: 'Nuovo gruppo' })
  await groupDialog.getByLabel('Nome').fill('Solo Instagram')
  await groupDialog.getByRole('checkbox', { name: /Instagram$/ }).click()
  await groupDialog.getByRole('button', { name: 'Crea gruppo' }).click()
  await expect(
    m.getByRole('list', { name: 'Gruppi di account' }).getByText('Solo Instagram'),
  ).toBeVisible()
  expect((await axe(m)).violations).toEqual([])
  await mctx.close()

  // ---- the Editor, in a new post: the default time, «Inserisci», «Gruppi», a label, a note
  const ectx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? '' })
  const e = await ectx.newPage()
  await ownAddress(e)
  await signIn(e.request, editor)
  // the Editor does not manage the client: no settings tab
  await e.goto(`/${org}/spazi/${client.slug}`)
  await expect(e.getByRole('link', { name: 'Contenuti', exact: true })).toHaveCount(0)
  await e.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await expect(e.locator('[data-time-field]')).toHaveAccessibleName('Ora: 9:30')

  const text = e.getByRole('textbox', { name: 'Testo comune' })
  await text.fill('Il pane di oggi')
  await e.getByRole('button', { name: 'Inserisci' }).click()
  await e.getByRole('menuitem', { name: /Firma del forno/ }).click()
  const igBox = e.locator(`[data-account="${ig}"]`)
  const fbBox = e.locator(`[data-account="${fb}"]`)
  if ((await fbBox.getAttribute('aria-checked')) === 'true') await fbBox.click()
  if ((await igBox.getAttribute('aria-checked')) === 'true') await igBox.click()
  await e.getByRole('button', { name: 'Gruppi' }).click()
  await e.getByRole('menuitem', { name: /Solo Instagram/ }).click()
  await expect(igBox).toHaveAttribute('aria-checked', 'true')
  await expect(fbBox).toHaveAttribute('aria-checked', 'false')
  await expect(e.getByText('«Solo Instagram»: spuntato 1 account.')).toBeVisible()

  await e.getByRole('button', { name: 'Etichetta', exact: true }).click()
  await e.getByRole('menuitemcheckbox', { name: 'Natale' }).click()
  await e.keyboard.press('Escape')
  const chosen = e.getByRole('list', { name: 'Etichette del post' })
  await expect(chosen.getByText('Natale')).toBeVisible()
  await expect(e.locator('[data-save-state]')).toContainText('Bozza salvata alle', {
    timeout: 10_000,
  })

  await e.getByLabel('Nuova nota per il team').fill('Il prezzo lo conferma Marta')
  await e.getByRole('button', { name: 'Aggiungi', exact: true }).click()
  await expect(e.getByText('Il prezzo lo conferma Marta')).toBeVisible()
  await expect(e.getByText(/^Tu · oggi alle/)).toBeVisible()
  expect((await axe(e)).violations).toEqual([])

  // all there after a reload
  await e.reload()
  await expect(chosen.getByText('Natale')).toBeVisible()
  await expect(e.getByText('Il prezzo lo conferma Marta')).toBeVisible()

  // a note taken off is asked first (P7 of the review): «Annulla» keeps it
  await e.getByLabel('Nuova nota per il team').fill('Da togliere')
  await e.getByRole('button', { name: 'Aggiungi', exact: true }).click()
  const last = e.getByRole('listitem').filter({ hasText: 'Da togliere' })
  await last.getByRole('button', { name: 'Togli la nota' }).click()
  const ask = e.getByRole('dialog', { name: 'Togliere la nota?' })
  await ask.getByRole('button', { name: 'Annulla' }).click()
  await expect(last).toBeVisible()
  await last.getByRole('button', { name: 'Togli la nota' }).click()
  await ask.getByRole('button', { name: 'Togli la nota' }).click()
  await expect(e.getByText('Da togliere')).toHaveCount(0)
  await expect(e.getByText('Il prezzo lo conferma Marta')).toBeVisible()

  // the label in the client's list of posts
  await e.goto(`/${org}/spazi/${client.slug}/post`)
  await expect(
    e.locator('[data-label]').filter({ hasText: 'Natale', visible: true }).first(),
  ).toBeVisible()
  await ectx.close()
})

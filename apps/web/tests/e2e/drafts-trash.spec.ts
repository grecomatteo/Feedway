import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { newWorkspace } from './support/meta.ts'
import { adminQuery, newPerson, ownAddress, signInWithTotp } from './support/people.ts'

// «Eliminati» of a client (plan 09 Task 14, Scelta 12): «Elimina» from the «⋯» of a draft with no
// question and «Annulla» in the notice, three drafts chosen and deleted together, the warning of
// a forgotten draft, the filter «Eliminati» with «Ripristina» and «Svuota», the editor of a post
// in «Eliminati» (read only, «Ripristina») and the client's choice in «Impostazioni dei contenuti».

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
const shots = process.env.E2E_SCREENSHOTS
/** A picture for the review, only when asked (E2E_SCREENSHOTS), named after the project. */
const shot = (page: Page, name: string) =>
  shots
    ? page.screenshot({ path: `${shots}/${test.info().project.name}-${name}.png` })
    : Promise.resolve()

async function draft(request: APIRequestContext, path: string, text: string) {
  const res = await request.post(path, {
    headers: { origin: new URL(process.env.E2E_BASE_URL ?? '').origin, 'x-app-request': '1' },
    data: { type: 'photo', caption: { common: text } },
  })
  expect(res.status()).toBe(200)
  return ((await res.json()) as { id: string }).id
}

test('«Elimina» with «Annulla», three drafts at once, «Eliminati» with «Ripristina» and «Svuota»', async ({
  page,
  isMobile,
}) => {
  const owner = await newPerson('Elia Elimina', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  const client = await newWorkspace(page.request, org, 'Forno Cestino')
  const posts = `/api/v1/orgs/${org}/workspaces/${client.id}/posts`
  for (const text of ['Il pane di segale', 'La torta di mele', 'Le brioche', 'I grissini'])
    await draft(page.request, posts, text)
  // a draft nobody touched for 26 days: it goes to «Eliminati» in 4 days, and says so
  const old = await draft(page.request, posts, 'La focaccia dimenticata')
  await adminQuery("update posts set updated_at = now() - interval '26 days' where id = $1", [old])

  await page.goto(`/${org}/spazi/${client.slug}/calendario?vista=elenco`)
  const drafts = page.locator('[data-list-drafts]')
  const row = (text: string) => drafts.locator('li').filter({ hasText: text })
  await expect(drafts.locator('[data-post]')).toHaveCount(5)
  await expect(row('La focaccia dimenticata').locator('[data-card-note]')).toHaveText(
    'Va negli Eliminati tra 4 giorni',
  )
  // no draft here has a time: no column of «—» before the pictures (F5 of the stage 9 review)
  await expect(drafts.locator('[data-row-time]')).toHaveCount(0)
  await shot(page, '01-bozze')

  // «⋯ → Elimina»: no question, gone at once, «Annulla» gives it back
  await row('Il pane di segale')
    .getByRole('button', { name: 'Azioni per Il pane di segale' })
    .click()
  await page.getByRole('menuitem', { name: 'Elimina' }).click()
  const toast = page.locator('[data-toast]')
  await expect(toast).toContainText('Bozza eliminata')
  await expect(drafts.locator('[data-post]')).toHaveCount(4)
  await shot(page, '02-bozza-eliminata')
  await toast.locator('[data-toast-action]').click()
  await expect(toast).toContainText('Ripristinato')
  await expect(drafts.locator('[data-post]')).toHaveCount(5)

  // «Seleziona», three boxes, «Elimina (3)»
  await drafts.locator('[data-list-select]').click()
  for (const text of ['La torta di mele', 'Le brioche', 'I grissini'])
    await row(text).locator('[data-row-select]').click()
  await expect(drafts.locator('[data-list-selection]')).toContainText('3 scelte')
  // the notice of «Annulla» is gone, so nothing covers the rows
  await expect(toast).toHaveCount(0, { timeout: 8000 })
  // from the top: scrolled, the sticky bar of the phone lies over the views (axe's target size)
  await page.evaluate(() => {
    window.scrollTo(0, 0)
  })
  expect((await axe(page)).violations).toEqual([])
  await shot(page, '03-selezione')
  await drafts.locator('[data-selection-trash]').click()
  await expect(toast).toContainText('3 bozze eliminate')
  await expect(drafts.locator('[data-post]')).toHaveCount(2)
  await expect(drafts.locator('[data-list-selection]')).toHaveCount(0)

  // «Eliminati»: the three, with the day they go for good
  if (isMobile) await page.goto(`/${org}/spazi/${client.slug}/calendario?vista=elenco&eliminati=1`)
  else
    await page
      .getByRole('group', { name: 'Filtri rapidi' })
      .getByRole('button', { name: 'Eliminati' })
      .click()
  const trash = page.locator('[data-list-trash]')
  await expect(trash.locator('[data-post]')).toHaveCount(3)
  await expect(trash.locator('[data-trash-note]')).toHaveText(
    'Si cancellano da soli dopo 30 giorni.',
  )
  await expect(trash.locator('[data-card-note]').first()).toHaveText('Si cancella tra 30 giorni')
  await expect(page.locator('[data-list-group]')).toHaveCount(0)
  // «Eliminati» does not depend on the days: no arrows, period or «Oggi», no column of the time
  for (const part of ['prev', 'next', 'period', 'today'])
    await expect(page.locator(`[data-calendar-${part}]`)).toHaveCount(0)
  await expect(trash.locator('[data-row-time]')).toHaveCount(0)
  expect((await axe(page)).violations).toEqual([])
  await shot(page, '04-eliminati')

  // «Ripristina» from the «⋯»: back among the drafts
  await trash
    .locator('li')
    .filter({ hasText: 'Le brioche' })
    .getByRole('button', { name: 'Azioni per Le brioche' })
    .click()
  await page.getByRole('menuitem', { name: 'Ripristina' }).click()
  await expect(trash.locator('[data-post]')).toHaveCount(2)

  // a post in «Eliminati» opens read only, with «Ripristina»
  await trash.locator('[data-post]').filter({ hasText: 'I grissini' }).click()
  const note = page.locator('[data-editor-trashed]')
  await expect(note).toContainText('Questa bozza è negli Eliminati')
  await expect(page.getByRole('textbox', { name: 'Testo comune' })).not.toBeEditable()
  await shot(page, '05-editor-eliminato')
  await page.goBack()

  // «Svuota» asks, then everything goes for good
  await page.locator('[data-trash-empty]').click()
  await page.locator('[data-trash-empty-confirm]').click()
  await expect(toast).toContainText('2 post eliminati per sempre')
  await expect(page.locator('[data-trash-none]')).toHaveText('Niente negli Eliminati.')
  const left = await adminQuery<{ n: string }>(
    'select count(*) as n from posts where workspace_id = $1',
    [client.id],
  )
  expect(Number(left[0]?.n)).toBe(3)
})

test('«Bozze dimenticate» in the content settings, and a new draft left empty goes when leaving', async ({
  page,
}) => {
  const owner = await newPerson('Rita Ritenzione', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  const client = await newWorkspace(page.request, org, 'Forno Tempo')

  await page.goto(`/${org}/spazi/${client.slug}/contenuti`)
  await expect(page.locator('[data-content-settings][data-ready]')).toBeVisible()
  const choice = page.getByRole('combobox', {
    name: 'Sposta negli Eliminati le bozze non toccate da',
  })
  await expect(choice).toContainText('30 giorni')
  await choice.click()
  await page.getByRole('option', { name: 'Mai', exact: true }).click()
  await expect(page.locator('[data-content-retention]').getByRole('status')).toHaveText('Salvato')
  const [saved] = await adminQuery<{ days: number | null }>(
    'select draft_retention_days as days from workspaces where id = $1',
    [client.id],
  )
  expect(saved?.days).toBeNull()
  expect((await axe(page)).violations).toEqual([])
  await shot(page, '06-bozze-dimenticate')

  // a new post: a character makes the draft; leaving without text or files takes it away
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  const text = page.getByRole('textbox', { name: 'Testo comune' })
  await text.fill('x')
  await expect(page).toHaveURL(/\/post\/[0-9a-f-]{36}$/)
  await text.fill('')
  await page.getByRole('link', { name: /Torna ai post di/ }).click()
  await expect(page).not.toHaveURL(/\/post\//)
  await expect
    .poll(
      async () =>
        Number(
          (
            await adminQuery<{ n: string }>(
              'select count(*) as n from posts where workspace_id = $1',
              [client.id],
            )
          )[0]?.n,
        ),
      { timeout: 10_000 },
    )
    .toBe(0)
})

test('«Elimina» from the editor, then «Annulla» in the list gives the draft back there', async ({
  page,
}) => {
  const owner = await newPerson('Edo Editor', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  const client = await newWorkspace(page.request, org, 'Forno Ritorno')
  const posts = `/api/v1/orgs/${org}/workspaces/${client.id}/posts`
  await draft(page.request, posts, 'Il panettone')
  const id = await draft(page.request, posts, 'Il pandoro')

  await page.goto(`/${org}/spazi/${client.slug}/calendario?vista=elenco`)
  const drafts = page.locator('[data-list-drafts]')
  await expect(drafts.locator('[data-post]')).toHaveCount(2)
  await drafts.locator(`[data-post="${id}"]`).click()
  await expect(page).toHaveURL(new RegExp(`/post/${id}$`))
  await page
    .getByRole('button', { name: 'Altre azioni del post' })
    .filter({ visible: true })
    .first()
    .click()
  await page.getByRole('menuitem', { name: 'Elimina' }).click()
  await expect(page).not.toHaveURL(/\/post\//)
  const toast = page.locator('[data-toast]')
  await expect(toast).toContainText('Bozza eliminata')
  await expect(drafts.locator('[data-post]')).toHaveCount(1)
  await toast.locator('[data-toast-action]').click()
  await expect(toast).toContainText('Ripristinato')
  await expect(drafts.locator(`[data-post="${id}"]`)).toBeVisible()
})

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { headers, newWorkspace, send } from './support/meta.ts'
import { addPerson, newPerson, ownAddress, signIn, signInWithTotp } from './support/people.ts'

// «Piano editoriale» (plan 09 Task 7, spec §11.12): from «Tutti i clienti» the page asks for the
// client; a month is planned in a row with Enter; a content moves by dragging (with «Annulla»)
// and with «Sposta…»; «Prepara» makes its post, the editor shows the content with its note, and
// the card says «Preparato»; the post deleted, the content is «Da preparare» again; «Prepara» as
// a link (`post/nuovo?piano=`). A Viewer reads the plan, note included, and changes
// nothing. On a phone the month is a list of days. Axe on the page and on the form.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

/** Axe once the windows have finished coming in: half-faded colours are not the page's. */
async function axe(page: Page) {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  )
  return new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
}

/** The month after the agency's one (Rome), all in the future: «2026-12», «Dicembre 2026». */
function nextMonth() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date())
  const [y, m] = today.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 0, m ?? 0, 1))
  const month = date.toISOString().slice(0, 7)
  const name = new Intl.DateTimeFormat('it-IT', { month: 'long', timeZone: 'UTC' }).format(date)
  return {
    month,
    name: `${name.charAt(0).toUpperCase()}${name.slice(1)} ${String(date.getUTCFullYear())}`,
    day: (d: number) => `${month}-${String(d).padStart(2, '0')}`,
  }
}

/** The month's grid on a computer, its list of days on a phone. */
const dayOf = (page: Page, isMobile: boolean, date: string) =>
  isMobile
    ? page.locator(`[data-plan-list] [data-plan-list-day="${date}"]`)
    : page.locator(`[data-plan-grid] [data-plan-day="${date}"]`)
const cardsOf = (page: Page, isMobile: boolean) =>
  page.locator(`${isMobile ? '[data-plan-list]' : '[data-plan-grid]'} [data-plan-item]`)

test('a month planned in a row, moved, prepared and given back', async ({ page, isMobile }) => {
  const owner = await newPerson('Olga Piano', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  const client = await newWorkspace(page.request, org, 'Forno Luce')
  const next = nextMonth()
  // the client's usual times on the weekday of the 10th: the form starts from the first free one
  const weekday = ((new Date(`${next.day(10)}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
  await send(page.request, 'PUT', `/api/v1/orgs/${org}/workspaces/${client.id}/time-slots`, {
    slots: [
      { weekday, localTime: '18:00' },
      { weekday, localTime: '11:00' },
    ],
  })

  // «Tutti i clienti»: the window asks for the client, and the choice becomes the context
  await page.goto(`/${org}/piano`)
  const ask = page.getByRole('dialog', { name: 'Per quale cliente fai il piano?' })
  await expect(ask).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
  await ask.getByRole('button', { name: 'Forno Luce' }).click()
  await expect(page).toHaveURL(new RegExp(`spazio=${client.slug}`))
  await expect(page.locator('[data-page-aside]')).toHaveText('Forno Luce')

  await page.getByRole('link', { name: 'Mese successivo' }).click()
  await expect(page.locator('[data-plan-month]')).toHaveText(next.name)
  await expect(page.locator('[data-plan-counts]')).toHaveText('Nessun contenuto')

  // three in a row: Enter saves and the form stays open, with the day and the type kept
  await dayOf(page, isMobile, next.day(10)).locator('[data-plan-add]').click()
  const form = page.getByRole('dialog', { name: 'Aggiungi al piano' })
  await expect(
    form.getByText('Il titolo può comparire nel calendario del cliente; la nota no.'),
  ).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
  const title = form.getByRole('textbox', { name: 'Titolo' })
  const time = form.locator('[data-time-field]')
  await expect(time).toHaveAttribute('aria-label', 'Ora: 11:00')
  // no title: said next to the field, nothing saved
  await title.press('Enter')
  await expect(form.getByText('Scrivi il titolo.')).toBeVisible()
  await title.fill('Pane caldo')
  await form.getByRole('textbox', { name: 'Nota per chi prepara' }).fill('Luce dalla vetrina')
  await title.press('Enter')
  await expect(form.locator('[data-plan-added]')).toContainText('Aggiunto «Pane caldo»')
  await expect(title).toBeFocused()
  await expect(title).toHaveValue('')
  // the 11:00 is taken: the next one starts from 18:00
  await expect(time).toHaveAttribute('aria-label', 'Ora: 18:00')
  await form.getByRole('button', { name: 'Carosello' }).click()
  await title.fill('Il menu della vigilia')
  await title.press('Enter')
  await expect(form.locator('[data-plan-added]')).toContainText('Il menu della vigilia')
  await title.fill('Gli orari delle feste')
  await title.press('Enter')
  await expect(form.locator('[data-plan-added]')).toContainText('Gli orari delle feste')
  await form.getByRole('button', { name: 'Chiudi' }).click()
  await expect(cardsOf(page, isMobile)).toHaveCount(3)
  await expect(page.locator('[data-plan-counts]')).toHaveText('3 contenuti')
  await expect(dayOf(page, isMobile, next.day(10)).locator('[data-plan-item]')).toHaveCount(3)

  const card = (name: string) => cardsOf(page, isMobile).filter({ hasText: name })

  // dragging, on a computer, with «Annulla»
  if (!isMobile) {
    await card('Gli orari delle feste').dragTo(dayOf(page, false, next.day(12)))
    await expect(dayOf(page, false, next.day(12)).locator('[data-plan-item]')).toHaveCount(1)
    await page.locator('[data-toast]').getByRole('button', { name: 'Annulla' }).click()
    await expect(dayOf(page, false, next.day(10)).locator('[data-plan-item]')).toHaveCount(3)
  }

  // «Sposta…» from the card's menu
  await card('Gli orari delle feste').click()
  await page.getByRole('menuitem', { name: 'Sposta…' }).click()
  const move = page.getByRole('dialog', { name: 'Sposta «Gli orari delle feste»' })
  await move.locator('[data-day-field]').click()
  await page.locator(`[data-day="${next.day(14)}"]`).click()
  await move.getByRole('button', { name: 'Sposta', exact: true }).click()
  await expect(dayOf(page, isMobile, next.day(14)).locator('[data-plan-item]')).toHaveCount(1)
  await expect(page.locator('[data-toast]')).toContainText('Spostato a')

  // «Prepara»: the post exists, the card says «Preparato»
  await card('Pane caldo').click()
  await page.getByRole('menuitem', { name: 'Prepara questo contenuto' }).click()
  await expect(page).toHaveURL(new RegExp(`/spazi/${client.slug}/post/[0-9a-f-]{36}`))
  const postId = page.url().split('/post/')[1]?.split(/[?#]/)[0] ?? ''
  // the editor shows what the plan asked for, the note in evidence (Task 7, PR 2)
  const fromPlan = page.locator('[data-post-plan]')
  await expect(fromPlan).toContainText('Pane caldo')
  await expect(fromPlan.locator('[data-post-plan-note]')).toContainText('Luce dalla vetrina')
  await expect(fromPlan.locator('[data-post-plan-day]')).toHaveCount(0)
  await expect(fromPlan.locator('[data-post-plan-type]')).toHaveCount(0)
  // the type of the plan is already chosen (spec §11.12)
  const types = page.getByRole('group', { name: 'Tipo' })
  await expect(types.getByRole('button', { name: 'Reel' })).toHaveAttribute('aria-pressed', 'true')
  expect((await axe(page)).violations).toEqual([])
  // another type is said, not refused
  await types.getByRole('button', { name: 'Storia' }).click()
  await expect(fromPlan.locator('[data-post-plan-type]')).toHaveText(
    'Tipo diverso dal piano: previsto reel, scelto storia.',
  )
  await expect(page.locator('[data-save-state]')).toContainText('Bozza salvata alle', {
    timeout: 10_000,
  })
  await page.goto(`/${org}/piano?spazio=${client.slug}&mese=${next.month}`)
  await expect(card('Pane caldo')).toHaveAttribute('data-state', 'prepared')
  await expect(card('Pane caldo')).toContainText('Preparato')
  await expect(page.locator('[data-plan-counts]')).toHaveText('3 contenuti · 1 preparato')

  // the post deleted: the content is to prepare again (rule 5)
  const gone = await page.request.fetch(
    `/api/v1/orgs/${org}/workspaces/${client.id}/posts/${postId}`,
    { method: 'DELETE', headers: headers() },
  )
  expect(gone.status()).toBe(200)
  await page.reload()
  await expect(card('Pane caldo')).toHaveAttribute('data-state', 'to_prepare')
  expect((await axe(page)).violations).toEqual([])

  // «Prepara» as a link: `post/nuovo?piano=` prepares the content and opens its draft, under
  // the content's own client even when the address names another one
  const feste = await card('Gli orari delle feste').getAttribute('data-plan-item')
  const other = await newWorkspace(page.request, org, 'Altro cliente')
  await page.goto(`/${org}/spazi/${other.slug}/post/nuovo?piano=${feste ?? ''}`)
  await expect(page).toHaveURL(new RegExp(`/spazi/${client.slug}/post/[0-9a-f-]{36}$`))
  await expect(page.locator('[data-post-plan]')).toContainText('Gli orari delle feste')
  await page.goto(`/${org}/piano?spazio=${client.slug}&mese=${next.month}`)
  await expect(card('Gli orari delle feste')).toHaveAttribute('data-state', 'prepared')

  // «Togli dal piano», with «Annulla»
  await card('Il menu della vigilia').click()
  await page.getByRole('menuitem', { name: 'Togli dal piano' }).click()
  await expect(cardsOf(page, isMobile)).toHaveCount(2)
  await page.locator('[data-toast]').getByRole('button', { name: 'Annulla' }).click()
  await expect(cardsOf(page, isMobile)).toHaveCount(3)
})

test('a Viewer reads the plan, note included, and changes nothing', async ({
  page,
  browser,
  isMobile,
}) => {
  const owner = await newPerson('Olga Lettura', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  const client = await newWorkspace(page.request, org, 'Bar Sole')
  const next = nextMonth()
  await send(page.request, 'POST', `/api/v1/orgs/${org}/plan`, {
    workspaceId: client.id,
    localDate: next.day(5),
    localTime: '09:00',
    type: 'photo',
    title: 'Gli orari delle feste',
    note: 'Foto dal bancone',
  })
  const viewer = await addPerson(org, 'Vera Viewer', 'member', [
    { workspaceId: client.id, role: 'viewer' },
  ])

  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? '',
    ...(isMobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}),
  })
  const v = await ctx.newPage()
  await ownAddress(v)
  await signIn(v.request, viewer)
  await v.goto(`/${org}/piano?spazio=${client.slug}&giorno=${next.day(5)}`)
  await expect(v.locator('[data-plan-month]')).toHaveText(next.name)
  await expect(v.locator('[data-plan-read-only]')).toBeVisible()
  await expect(v.locator('[data-plan-add]')).toHaveCount(0)
  const card = cardsOf(v, isMobile).filter({ hasText: 'Gli orari delle feste' })
  await expect(card).toContainText('Foto · 09:00')
  await expect(card).not.toHaveAttribute('draggable', 'true')
  await card.click()
  await expect(v.getByRole('menuitem')).toHaveText(['Apri'])
  await v.getByRole('menuitem', { name: 'Apri' }).click()
  const view = v.getByRole('dialog', { name: 'Contenuto del piano' })
  await expect(view).toContainText('Foto dal bancone')
  await expect(view.getByRole('textbox')).toHaveCount(0)
  expect((await axe(v)).violations).toEqual([])
  await ctx.close()
})

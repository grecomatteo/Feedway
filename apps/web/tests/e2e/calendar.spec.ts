import AxeBuilder from '@axe-core/playwright'
import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { DESIGN_NOW, romeInstant } from './support/design-sample.ts'
import { libraryFile } from './support/media.ts'
import { connectedAgency, newWorkspace } from './support/meta.ts'
import {
  addPerson,
  adminQuery,
  newPerson,
  ownAddress,
  signIn,
  signInWithTotp,
} from './support/people.ts'

// The calendar (plan 09 Task 3, screen 07): the month and the week of every client or of one,
// the filters in the address, the day in a sheet, the Viewer. The browser stops on Thursday 19
// November 2026 at 10:00 in Rome.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
  await page.clock.setFixedTime(DESIGN_NOW)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

const ready = (page: Page) => expect(page.locator('[data-ready]').first()).toBeVisible()
/** axe reads the colours of a window still fading in as too faint */
const settled = (dialog: Locator) =>
  dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
const day = (page: Page, date: string) => page.locator(`[data-day="${date}"]`)

async function send(page: Page, path: string, data: unknown) {
  const res = await page.request.post(path, {
    headers: { origin: new URL(process.env.E2E_BASE_URL ?? '').origin, 'x-app-request': '1' },
    data,
  })
  expect(res.status(), `POST ${path}`).toBe(200)
  return (await res.json()) as { id: string }
}

/**
 * Two clients of an Owner, each with an Instagram. Forno Prova: two posts on Thursday 19 (one with
 * a picture), one on Friday and a draft with a day on Tuesday 24. Osteria Prova: one on Thursday,
 * one that did not go out on Tuesday 17, one on Saturday and five on Thursday 26.
 */
async function agency(page: Page, name: string) {
  const owner = await newPerson(name, 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  const forno = await newWorkspace(page.request, org, 'Forno Prova')
  const osteria = await newWorkspace(page.request, org, 'Osteria Prova')
  const { connectionId } = await connectedAgency(page.request, org, { importAccounts: false })
  const instagram = async (workspaceId: string, username: string) => {
    const id = randomUUID()
    await adminQuery(
      `insert into social_accounts (id, organization_id, platform, external_id, name, username,
                                    connection_id, health, last_synced_at)
       values ($1, $2, 'instagram', $3, $4, $4, $5, 'ok', now())`,
      [id, org, String(Math.floor(Math.random() * 1e15)), username, connectionId],
    )
    await adminQuery(
      'insert into workspace_accounts (organization_id, workspace_id, account_id) values ($1, $2, $3)',
      [org, workspaceId, id],
    )
    return id
  }
  const igForno = await instagram(forno.id, 'fornoprova')
  const igOsteria = await instagram(osteria.id, 'osteriaprova')
  const photo = await libraryFile(org, forno.id, owner.userId, { kind: 'image', name: 'pane.jpg' })

  const ids: Record<string, string> = {}
  const post = async (
    workspaceId: string,
    accountId: string,
    caption: string,
    at: string,
    status = 'scheduled',
    mediaIds: string[] = [],
  ) => {
    const created = await send(page, `/api/v1/orgs/${org}/workspaces/${workspaceId}/posts`, {
      type: 'photo',
      caption: { common: caption },
      mediaIds,
      destinations: [{ accountId }],
    })
    ids[caption] = created.id
    // in place of «Programma», which refuses a time already gone
    await adminQuery(
      'update posts set status = $3, scheduled_by = created_by, scheduled_at = $2 where id = $1',
      [created.id, romeInstant(at), status],
    )
  }
  await post(forno.id, igForno, 'Il pane del giovedì', '2026-11-19T12:00', 'scheduled', [photo])
  await post(forno.id, igForno, 'La focaccia della sera', '2026-11-19T18:00')
  await post(forno.id, igForno, 'Le brioche del venerdì', '2026-11-20T08:00')
  await post(forno.id, igForno, 'Una bozza con il giorno', '2026-11-24T11:00', 'draft')
  await post(osteria.id, igOsteria, 'Il pranzo del giovedì', '2026-11-19T09:30')
  await post(osteria.id, igOsteria, 'Il menu non uscito', '2026-11-17T13:00', 'failed')
  await post(osteria.id, igOsteria, 'Il pranzo del sabato', '2026-11-21T13:00')
  for (const hour of ['09', '11', '13', '17', '20'])
    await post(osteria.id, igOsteria, `Il giorno pieno, alle ${hour}`, `2026-11-26T${hour}:00`)
  // the plan of Forno Prova: a reel still to prepare on Monday 23, one due in less than 36 hours
  const plan = (title: string, type: string, day: string, time: string) =>
    adminQuery(
      `insert into plan_items (id, organization_id, workspace_id, local_date, local_time, type,
                               title, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [randomUUID(), org, forno.id, day, time, type, title, owner.userId],
    )
  await plan('Il panettone in vetrina', 'reel', '2026-11-23', '10:00')
  await plan('Le castagne della sera', 'carousel', '2026-11-19', '19:00')
  // past the list's first 42 days (to 30 December): read by «Mostra altri»
  await post(forno.id, igForno, 'Il pane di gennaio', '2027-01-12T09:00')
  await plan('La befana in vetrina', 'photo', '2027-01-06', '10:00')
  return { org, forno, osteria, ids }
}

test('the month and the week of every client, with the address that keeps them', async ({
  page,
  isMobile,
}) => {
  const { org, ids, forno } = await agency(page, 'Carla Calendario')
  // the month: a computer opens on it, a phone on the list
  await page.goto(isMobile ? `/${org}/calendario?vista=mese` : `/${org}/calendario`)
  await ready(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Calendario' })).toBeVisible()
  await expect(page.locator('[data-calendar-period]')).toHaveText('Novembre 2026')
  await expect(day(page, '2026-11-19')).toHaveAttribute('data-today', 'true')
  await expect(day(page, '2026-11-19').locator('[data-day-open]')).toHaveAccessibleName(
    'giovedì 19 novembre, Oggi, 3 post, 1 da preparare',
  )

  if (isMobile) {
    // a phone reads the month by its dots: three posts and the plan's content
    await expect(day(page, '2026-11-19').locator('[data-day-dots] i')).toHaveCount(4)
  } else {
    const chips = day(page, '2026-11-19').locator('[data-post]')
    await expect(chips).toHaveCount(3)
    await expect(chips.first()).toContainText('09:30')
    await expect(chips.first()).toContainText('Osteria Prova')
    // five posts do not fit: three and «+2»
    await expect(day(page, '2026-11-26').locator('[data-post]')).toHaveCount(3)
    await expect(day(page, '2026-11-26').locator('[data-day-more]')).toHaveText('+2')
    // a draft with a day: full border and «Bozza» (D-123.3); red where one did not go out
    await expect(day(page, '2026-11-24').locator('[data-draft]')).toContainText('Bozza')
    await expect(day(page, '2026-11-17').locator('[data-tone="danger"]')).toHaveCount(1)
    // the format on every card, and the plan's content still to prepare, dashed (Matteo 25/11)
    await expect(chips.first().locator('[data-post-type="photo"]')).toHaveCount(1)
    const planned = day(page, '2026-11-23').locator('[data-plan]')
    await expect(planned).toHaveAttribute('data-look', 'plan')
    await expect(planned.locator('[data-post-type="reel"]')).toHaveCount(1)
    await expect(planned).toHaveAccessibleName(/^10:00, Reel, Forno Prova, Il panettone/)
    await expect(planned).toHaveAttribute(
      'href',
      `/${org}/piano?spazio=${forno.slug}&giorno=2026-11-23`,
    )
  }
  expect((await axe(page)).violations).toEqual([])
  await day(page, '2026-11-19').locator('[data-day-open]').click()
  if (isMobile) {
    // a phone lists the day under the month, with the plan's content
    const listed = page.locator('[data-month-day]')
    await expect(listed.locator('[data-post]')).toHaveCount(3)
    // its state is counted by the server's clock, which the browser's does not stop
    await expect(listed.locator('[data-plan]')).toContainText('Le castagne della sera')
  } else {
    const sheet = page.getByRole('dialog', { name: 'Oggi, giovedì 19 novembre 2026' })
    await expect(sheet.locator('[data-post]')).toHaveCount(3)
    await expect(sheet.locator('[data-plan]')).toHaveCount(1)
    await settled(sheet)
    expect((await axe(page)).violations).toEqual([])
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
  }

  // the next month goes into the address, and a reload keeps it
  await page.locator('[data-calendar-next]').click()
  await expect(page).toHaveURL(/da=2026-12-01/)
  await expect(page.locator('[data-calendar-period]')).toHaveText('Dicembre 2026')
  await page.reload()
  await ready(page)
  await expect(page.locator('[data-calendar-period]')).toHaveText('Dicembre 2026')
  await page.locator('[data-calendar-today]').click()
  await expect(page).not.toHaveURL(/da=/)
  await expect(page.locator('[data-calendar-period]')).toHaveText('Novembre 2026')

  // the week: the posts of the 19th as large cards, in their order
  await page
    .getByRole('group', { name: 'Vista' })
    .getByRole('button', { name: 'Settimana' })
    .click()
  await expect(page).toHaveURL(/vista=settimana/)
  await expect(page.locator('[data-calendar-period]')).toHaveText('16–22 novembre 2026')
  const tiles = page.locator('[data-calendar-week] [data-day="2026-11-19"] [data-post]')
  await expect(tiles).toHaveCount(3)
  await expect(tiles.nth(1)).toContainText('Il pane del giovedì')
  await expect(tiles.nth(1).locator('img')).toHaveCount(1)
  const planTile = page.locator('[data-calendar-week] [data-day="2026-11-19"] [data-plan]')
  await expect(planTile).toHaveAttribute('data-look', 'plan')
  await expect(planTile.locator('[data-post-type="carousel"]')).toHaveCount(1)
  expect((await axe(page)).violations).toEqual([])

  // a card opens its post
  await tiles.nth(1).click()
  await expect(page).toHaveURL(new RegExp(`/post/${ids['Il pane del giovedì'] ?? ''}`))
})

test('the list: the drafts without a date on top, the days in their groups, more days', async ({
  page,
  isMobile,
}) => {
  const { org, forno } = await agency(page, 'Lia Elenco')
  await send(page, `/api/v1/orgs/${org}/workspaces/${forno.id}/posts`, {
    type: 'photo',
    caption: { common: 'Un’idea senza giorno' },
  })
  // the list is the phone's view; a computer opens on the month
  await page.goto(isMobile ? `/${org}/calendario` : `/${org}/calendario?vista=elenco`)
  await ready(page)
  const list = page.locator('[data-calendar-list]')
  await expect(list).toBeVisible()
  await expect(page.locator('[data-calendar-period]')).toHaveText('19 nov – 30 dic 2026')
  await expect(list.locator('[data-list-drafts] [data-post]')).toHaveCount(1)
  await expect(list.locator('[data-list-drafts]')).toContainText('Un’idea senza giorno')
  await expect(list.locator('[data-list-group]')).toHaveCount(4)
  const groups = await list
    .locator('[data-list-group]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-list-group')))
  expect(groups).toEqual(['today', 'tomorrow', 'thisWeek', 'later'])
  // today by time, the plan's content in its place (D-79)
  const today = list.locator('[data-list-group="today"] a')
  await expect(today).toHaveCount(4)
  await expect(today.first()).toContainText('09:30')
  await expect(today.last()).toContainText('Le castagne della sera')
  expect((await axe(page)).violations).toEqual([])

  // «Mostra altri»: the next 42 days under these, posts and the plan's contents
  await expect(list).not.toContainText('Il pane di gennaio')
  await expect(list).not.toContainText('La befana in vetrina')
  await list.locator('[data-list-more]').click()
  await expect(list.locator('[data-list-group="later"]')).toContainText('Il pane di gennaio')
  await expect(list.locator('[data-list-group="later"]')).toContainText('La befana in vetrina')
  await expect(list.locator('[data-list-more]')).toBeEnabled()
  await expect(list.locator('[data-list-group]')).toHaveCount(4)
  // the days before: the one that did not go out, earlier this week
  await page.locator('[data-calendar-prev]').click()
  await expect(page).toHaveURL(/da=2026-10-08/)
  await expect(
    list.locator('[data-list-group="earlierThisWeek"] [data-post][data-tone="danger"]'),
  ).toHaveCount(1)
})

test('the filters go into the address and narrow the read', async ({ page, isMobile }) => {
  const { org, forno } = await agency(page, 'Filippo Filtri')
  await page.goto(`/${org}/calendario?vista=settimana`)
  await ready(page)
  const cards = page.locator('[data-calendar-week] [data-post]')
  await expect(cards).toHaveCount(6)
  const open = page.locator('[data-filters-open]:visible')
  const dialog = page.getByRole('dialog', { name: 'Filtri' })

  // «Con problema»: only the post that did not go out, and the reload keeps it; on a phone the
  // quick filters are in the sheet
  if (isMobile) {
    await open.click()
    await settled(dialog)
    await dialog.getByRole('radio', { name: 'Con problema' }).click()
    await dialog.getByRole('button', { name: 'Fatto' }).click()
  } else
    await page
      .getByRole('group', { name: 'Filtri rapidi' })
      .getByRole('button', { name: 'Con problema' })
      .click()
  await expect(page).toHaveURL(/rapido=con-problema/)
  await expect(cards).toHaveCount(1)
  await page.reload()
  await ready(page)
  await expect(cards).toHaveCount(1)
  if (isMobile) {
    await open.click()
    await dialog.locator('[data-filters-clear]').click()
    await dialog.getByRole('button', { name: 'Fatto' }).click()
  } else await page.locator('[data-calendar-clear]').click()
  await expect(cards).toHaveCount(6)

  // «Mostra»: the posts without the plan, in the address, and back
  const planned = page.locator('[data-calendar-week] [data-plan]')
  await expect(planned).toHaveCount(1)
  if (!isMobile) {
    const show = page.getByRole('group', { name: 'Mostra' })
    await show.getByRole('button', { name: 'Post' }).click()
    await expect(page).toHaveURL(/mostra=post/)
    await expect(planned).toHaveCount(0)
    await expect(cards).toHaveCount(6)
    // «Togli i filtri» puts «Mostra» back too
    await page.locator('[data-calendar-clear]').click()
    await expect(page).not.toHaveURL(/mostra=/)
    await expect(planned).toHaveCount(1)
  }

  // a client in «Filtri»
  await open.click()
  await settled(dialog)
  await dialog.getByRole('checkbox', { name: 'Forno Prova' }).click()
  await expect(page).toHaveURL(new RegExp(`cliente=${forno.id}`))
  await expect(cards).toHaveCount(3)
  await settled(dialog)
  expect((await axe(page)).violations).toEqual([])
  await dialog.getByRole('button', { name: 'Fatto' }).click()
  await expect(open).toHaveAccessibleName('Filtri, 1 attivo')
  await page.reload()
  await ready(page)
  await expect(cards).toHaveCount(3)
})

test('a client of the selector, and a Viewer without pictures', async ({ page, browser }) => {
  const { org, forno, osteria } = await agency(page, 'Sara Spazio')
  await page.goto(`/${org}/calendario?spazio=${forno.slug}&vista=settimana`)
  await ready(page)
  const cards = page.locator('[data-calendar-week] [data-post]')
  await expect(cards).toHaveCount(3)
  // inside a client the card does not repeat its name
  await expect(page.locator('[data-calendar-week] [data-card-client]')).toHaveCount(0)

  const viewer = await addPerson(org, 'Vera Vista', 'member', [
    { workspaceId: osteria.id, role: 'viewer' },
  ])
  const other = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? '' })
  const vera = await other.newPage()
  await ownAddress(vera)
  await vera.clock.setFixedTime(DESIGN_NOW)
  await signIn(vera.request, viewer)
  await vera.goto(`/${org}/calendario?vista=settimana`)
  await ready(vera)
  // only the client she sees, and no thumbnails (D-72)
  await expect(vera.locator('[data-calendar-week] [data-post]')).toHaveCount(3)
  await expect(vera.locator('[data-calendar-week] img')).toHaveCount(0)
  // nothing to move for who only reads (plan 09 Task 4)
  await expect(vera.locator('[data-movable]')).toHaveCount(0)
  await expect(vera.locator('[data-card-actions]')).toHaveCount(0)
  await other.close()
})

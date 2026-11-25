import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { libraryFile } from './support/media.ts'
import { newWorkspace, send } from './support/meta.ts'
import { newPerson, ownAddress, signInWithTotp } from './support/people.ts'

// The «+» of a day and «Libreria» of the calendar (plan 09 Task 4, Scelte 4 and 5): the «+»
// opens a new post of that day, with the client's first free slot of the day or its usual time,
// never on a day gone; from «Tutti i clienti» the client is asked first. In a client «Libreria»
// opens beside the calendar: a file dragged onto a day, or «Usa in un post», starts the post.
// The days are in the month after the real one: the server checks the slots with its own clock.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

async function axe(page: Page) {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  )
  return new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
}

/** A day of the month after the agency's one (Rome), and one of the month before. */
function days() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date())
  const [y, m] = today.split('-').map(Number)
  const of = (shift: number, d: number) =>
    new Date(Date.UTC(y ?? 0, (m ?? 1) - 1 + shift, d)).toISOString().slice(0, 10)
  return { next: (d: number) => of(1, d), before: (d: number) => of(-1, d) }
}
const weekday = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
const LONG = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})
const long = (date: string) => LONG.format(new Date(`${date}T00:00:00Z`))

async function dragOnto(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  if (!a || !b) throw new Error('not on screen')
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2 + 10, { steps: 5 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 })
  await page.mouse.up()
}

test('the «+» of a day opens its new post, with the first free slot of that day', async ({
  page,
}) => {
  const owner = await newPerson('Pia Più', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  const forno = await newWorkspace(page.request, org, 'Forno Luce')
  const d = days()
  const slotDay = d.next(10)
  await send(page.request, 'PUT', `/api/v1/orgs/${org}/workspaces/${forno.id}/time-slots`, {
    slots: [{ weekday: weekday(slotDay), localTime: '10:30' }],
  })

  // a day gone has no «+»
  await page.goto(`/${org}/spazi/${forno.slug}/calendario?vista=settimana&da=${d.before(10)}`)
  await expect(page.locator('[data-ready]').first()).toBeVisible()
  await expect(page.locator('[data-calendar-week] [data-day-add]')).toHaveCount(0)

  await page.goto(`/${org}/spazi/${forno.slug}/calendario?vista=settimana&da=${slotDay}`)
  await expect(page.locator('[data-ready]').first()).toBeVisible()
  const add = page.locator(`[data-calendar-week] [data-day="${slotDay}"] [data-day-add]`)
  await expect(add).toHaveAccessibleName(`Nuovo post per ${long(slotDay)}`)
  expect((await axe(page)).violations).toEqual([])
  await add.click()
  await expect(page).toHaveURL(new RegExp(`/spazi/${forno.slug}/post/nuovo\\?giorno=${slotDay}`))
  await expect(page.locator('[data-day-field]')).toHaveAccessibleName(
    new RegExp(`^Giorno: ${long(slotDay)}`),
  )
  await expect(page.locator('[data-time-field]')).toHaveAccessibleName('Ora: 10:30')

  // another day without a slot: the client's usual time
  await page.goto(`/${org}/spazi/${forno.slug}/post/nuovo?giorno=${d.next(11)}`)
  await expect(page.locator('[data-time-field]')).toHaveAccessibleName('Ora: 14:00')
})

test('from «Tutti i clienti» the «+» asks the client, then opens its post of that day', async ({
  page,
}) => {
  const owner = await newPerson('Rino Radice', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await newWorkspace(page.request, org, 'Forno Luce')
  const osteria = await newWorkspace(page.request, org, 'Osteria Prova')
  const day = days().next(12)
  await page.goto(`/${org}/calendario?vista=settimana&da=${day}`)
  await expect(page.locator('[data-ready]').first()).toBeVisible()
  await page.locator(`[data-calendar-week] [data-day="${day}"] [data-day-add]`).click()
  await expect(page).toHaveURL(new RegExp(`/${org}/post/nuovo\\?giorno=${day}`))
  await page.getByRole('link', { name: 'Osteria Prova' }).click()
  await expect(page).toHaveURL(new RegExp(`/spazi/${osteria.slug}/post/nuovo\\?giorno=${day}`))
  await expect(page.locator('[data-day-field]')).toHaveAccessibleName(
    new RegExp(`^Giorno: ${long(day)}`),
  )
})

test('«Libreria» beside the calendar: a file dragged onto a day, or «Usa in un post»', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'the library of the calendar is on a computer only')
  const owner = await newPerson('Lia Libri', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  const forno = await newWorkspace(page.request, org, 'Forno Luce')
  const file = await libraryFile(org, forno.id, owner.userId, { kind: 'image', name: 'pane.jpg' })
  const day = days().next(14)
  await page.goto(`/${org}/spazi/${forno.slug}/calendario?vista=mese&da=${day}`)
  await expect(page.locator('[data-ready]').first()).toBeVisible()
  // closed until asked
  await expect(page.locator('[data-calendar-library]')).toHaveCount(0)
  await page.locator('[data-calendar-library-toggle]').click()
  const panel = page.locator('[data-calendar-library]')
  const tile = panel.locator(`[data-library-file="${file}"]`)
  await expect(tile).toContainText('pane.jpg')
  expect((await axe(page)).violations).toEqual([])

  await dragOnto(
    page,
    tile.locator('[data-library-drag]'),
    page.locator(`[data-calendar-month] [data-day="${day}"]`),
  )
  await expect(page).toHaveURL(new RegExp(`post/nuovo\\?giorno=${day}&file=${file}`))
  await expect(page.locator('[data-entry]')).toHaveCount(1)

  await page.goBack()
  await page.locator('[data-calendar-library-toggle]').click()
  await page.locator(`[data-library-file="${file}"] [data-library-use]`).click()
  await expect(page).toHaveURL(new RegExp(`post/nuovo\\?file=${file}`))
  await expect(page.locator('[data-entry]')).toHaveCount(1)
})

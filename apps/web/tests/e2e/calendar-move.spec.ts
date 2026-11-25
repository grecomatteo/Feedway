import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { DESIGN_NOW, romeInstant } from './support/design-sample.ts'
import { newWorkspace } from './support/meta.ts'
import { adminQuery, newPerson, ownAddress, signInWithTotp } from './support/people.ts'

// Moving a post in the calendar (plan 09 Task 4, P7): dragged onto another day on a computer,
// «Sposta…» from the card's menu everywhere, «Annulla» that puts it back. The browser stops on
// Thursday 19 November 2026; the drafts are in January 2027, ahead of the browser and the server.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
  await page.clock.setFixedTime(DESIGN_NOW)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
const ready = (page: Page) => expect(page.locator('[data-ready]').first()).toBeVisible()
const cell = (page: Page, date: string) =>
  page.locator(`[data-calendar-month] [data-day="${date}"]`)

async function draftOn(
  page: Page,
  org: string,
  workspaceId: string,
  caption: string,
  when: string,
) {
  const res = await page.request.post(`/api/v1/orgs/${org}/workspaces/${workspaceId}/posts`, {
    headers: { origin: new URL(process.env.E2E_BASE_URL ?? '').origin, 'x-app-request': '1' },
    data: {
      type: 'photo',
      caption: { common: caption },
      when: { localDate: when.slice(0, 10), localTime: when.slice(11) },
    },
  })
  expect(res.status()).toBe(200)
  return ((await res.json()) as { id: string }).id
}
/**
 * A drag with the mouse in small steps: `dragTo` presses on the card and lets go on the day
 * without the moves Chromium needs to start a drag of a link.
 */
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
const scheduledAt = async (id: string) =>
  (
    await adminQuery<{ scheduled_at: Date }>('select scheduled_at from posts where id = $1', [id])
  )[0]?.scheduled_at.toISOString()

test('a post moves onto another day and back with «Annulla»; «Sposta…» changes day and time', async ({
  page,
  isMobile,
}) => {
  const owner = await newPerson('Marta Mossa', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  const forno = await newWorkspace(page.request, org, 'Forno Prova')
  const id = await draftOn(page, org, forno.id, 'La bozza da spostare', '2027-01-14T11:00')

  // dragging, on a computer: the month of January 2027
  if (!isMobile) {
    await page.goto(`/${org}/spazi/${forno.slug}/calendario?vista=mese&da=2027-01-01`)
    await ready(page)
    const chip = page.locator(`[data-calendar-month] [data-post="${id}"]`)
    await expect(chip).toHaveAttribute('data-movable', 'true')
    await dragOnto(page, chip, cell(page, '2027-01-20'))
    await expect(cell(page, '2027-01-20').locator(`[data-post="${id}"]`)).toBeVisible()
    const toast = page.locator('[data-toast]')
    await expect(toast).toContainText('Spostato a mer 20 gen 2027 alle 11:00.')
    await expect.poll(() => scheduledAt(id)).toBe(romeInstant('2027-01-20T11:00'))
    await toast.getByRole('button', { name: 'Annulla' }).click()
    await expect(cell(page, '2027-01-14').locator(`[data-post="${id}"]`)).toBeVisible()
    await expect.poll(() => scheduledAt(id)).toBe(romeInstant('2027-01-14T11:00'))
  }

  // «Sposta…» from the row's menu, the way of the keyboard and the phone
  await page.goto(`/${org}/spazi/${forno.slug}/calendario?vista=elenco&da=2027-01-01`)
  await ready(page)
  const row = page.locator(`[data-post="${id}"]`).first()
  await expect(row).toBeVisible()
  await page.getByRole('button', { name: 'Azioni per La bozza da spostare' }).click()
  await page.getByRole('menuitem', { name: 'Sposta…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sposta «La bozza da spostare»' })
  await expect(dialog.locator('[data-time-field]')).toHaveAccessibleName('Ora: 11:00')
  expect((await axe(page)).violations).toEqual([])
  await dialog.locator('[data-day-field]').click()
  await page.locator('[data-day-picker] [data-day="2027-01-15"]').click()
  await dialog.locator('[data-time-field]').click()
  await page.locator('[data-time-picker] [data-time="16:30"]').click()
  await dialog.getByRole('button', { name: 'Sposta', exact: true }).click()
  await expect(page.locator('[data-toast]')).toContainText('Spostato a ven 15 gen 2027 alle 16:30.')
  await expect.poll(() => scheduledAt(id)).toBe(romeInstant('2027-01-15T16:30'))
})

test('a move another person beat is refused and said, and the post stays', async ({ page }) => {
  const owner = await newPerson('Nino Nodo', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  const forno = await newWorkspace(page.request, org, 'Forno Prova')
  const id = await draftOn(page, org, forno.id, 'La bozza contesa', '2027-01-14T11:00')
  await page.goto(`/${org}/spazi/${forno.slug}/calendario?vista=elenco&da=2027-01-01`)
  await ready(page)
  await expect(page.locator(`[data-post="${id}"]`).first()).toBeVisible()
  // another person saves it after the calendar read it
  await adminQuery('update posts set version = version + 1 where id = $1', [id])
  await page.getByRole('button', { name: 'Azioni per La bozza contesa' }).click()
  await page.getByRole('menuitem', { name: 'Sposta…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sposta «La bozza contesa»' })
  await dialog.locator('[data-time-field]').click()
  await page.locator('[data-time-picker] [data-time="16:30"]').click()
  await dialog.getByRole('button', { name: 'Sposta', exact: true }).click()
  await expect(page.locator('[data-calendar-move-problem]')).toHaveText(
    '«La bozza contesa» non si è spostato. Un’altra persona l’ha cambiato nel frattempo: il calendario ora è aggiornato.',
  )
  expect(await scheduledAt(id)).toBe(romeInstant('2027-01-14T11:00'))
})

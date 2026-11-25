import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { newWorkspace } from './support/meta.ts'
import { adminQuery, newPerson, ownAddress, signInWithTotp } from './support/people.ts'

// «In blocco» and «Duplica» from the calendar (plan 09 Task 10): the client's calendar leads to
// the table, and a card's menu copies its post on other days, as the post's page does.

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
const ready = (page: Page) => expect(page.locator('[data-ready]').first()).toBeVisible()

test('the client calendar leads to «In blocco»; «Duplica» from a card makes a draft copy', async ({
  page,
}) => {
  const owner = await newPerson('Dora Doppia', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  const forno = await newWorkspace(page.request, org, 'Forno Copia')
  const res = await page.request.post(`/api/v1/orgs/${org}/workspaces/${forno.id}/posts`, {
    headers: { origin: new URL(process.env.E2E_BASE_URL ?? '').origin, 'x-app-request': '1' },
    data: {
      type: 'photo',
      caption: { common: 'La bozza da copiare' },
      when: { localDate: '2027-01-14', localTime: '11:00' },
    },
  })
  expect(res.status()).toBe(200)

  await page.goto(`/${org}/spazi/${forno.slug}/calendario?vista=elenco&da=2027-01-01`)
  await ready(page)
  await page.getByRole('button', { name: 'Azioni per La bozza da copiare' }).click()
  await shot(page, 'calendario-menu')
  await page.getByRole('menuitem', { name: 'Duplica' }).click()
  const dialog = page.getByRole('dialog', { name: 'Duplica il post' })
  await expect(dialog).toBeVisible()
  // the copy at the post's own time
  await expect(dialog.locator('[data-time-field]')).toHaveAccessibleName(/11:00/)
  expect((await axe(page)).violations).toEqual([])
  await shot(page, 'calendario-duplica')
  await dialog.locator('[data-duplicate-drafts]').click()
  await expect(dialog.locator('[data-bulk-summary][data-status="done"]')).toBeVisible()
  // a draft asked for is not one to fix
  await expect(dialog.locator('[data-bulk-line]')).toHaveText('1 bozza, niente da sistemare')
  await shot(page, 'calendario-duplica-fatto')
  expect(
    await adminQuery("select id from posts where workspace_id = $1 and status = 'draft'", [
      forno.id,
    ]),
  ).toHaveLength(2)
  await dialog.getByRole('button', { name: 'Chiudi' }).first().click()
  await expect(dialog).toHaveCount(0)

  await page.locator('[data-calendar-bulk]').click()
  await expect(page).toHaveURL(/\/post\/in-blocco$/)
  await expect(page.getByRole('heading', { level: 1, name: 'In blocco' })).toBeVisible()
})

test('an archived client has no «In blocco»', async ({ page }) => {
  const owner = await newPerson('Vera Vista', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  const forno = await newWorkspace(page.request, org, 'Forno Guardato')
  await adminQuery('update workspaces set archived_at = now() where id = $1', [forno.id])
  await page.goto(`/${org}/spazi/${forno.slug}/calendario?vista=elenco`)
  await ready(page)
  await expect(page.locator('[data-calendar-bulk]')).toHaveCount(0)
})

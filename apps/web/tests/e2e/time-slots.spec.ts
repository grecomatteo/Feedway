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

// «Fasce orarie» in the client's content settings and «Prossima fascia libera» in the editor
// (plan 09 Task 9, spec §11.6): a Manager adds times and copies Monday on Tuesday–Friday, an
// Editor reads them and takes the first free one in a new post; axe on both pages.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

test('a Manager sets the usual times; an Editor takes the next free one', async ({
  page,
  browser,
}) => {
  const owner = await newPerson('Olga Fasce', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)
  const client = await newWorkspace(page.request, org, 'Forno Luce')
  for (const { id } of await adminQuery<{ id: string }>(
    "select id from social_accounts where organization_id = $1 and name = 'Forno Luce'",
    [org],
  ))
    await assignAccount(page.request, org, client.id, id)
  const manager = await addPerson(org, 'Marta Manager', 'member', [
    { workspaceId: client.id, role: 'manager' },
  ])
  const editor = await addPerson(org, 'Elia Editor', 'member', [
    { workspaceId: client.id, role: 'editor' },
  ])

  // ---- the Manager
  const mctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? '' })
  const m = await mctx.newPage()
  await ownAddress(m)
  await signIn(m.request, manager)
  await m.goto(`/${org}/spazi/${client.slug}/contenuti`)
  const section = m.locator('[data-content-slots]')
  await expect(section.locator('[data-slot-day]')).toHaveCount(7)
  await expect(section.getByRole('button', { name: 'Copia il lunedì su mar–ven' })).toBeDisabled()
  for (const time of ['12:30', '18:00']) {
    await section.getByRole('combobox', { name: 'Aggiungi una fascia di Lunedì' }).click()
    await m.getByRole('option', { name: time, exact: true }).click()
    await expect(
      section.locator('[data-slot-day="1"] [data-time-slot]', { hasText: time }),
    ).toBeVisible()
  }
  await section.getByRole('button', { name: 'Copia il lunedì su mar–ven' }).click()
  await expect(section.locator('[data-time-slot]')).toHaveCount(10)
  await expect(section.getByRole('status')).toHaveText('Salvato')
  // a chip's «×» takes the time off that day only
  await section.getByRole('button', { name: 'Togli le 18:00 di Venerdì' }).click()
  await expect(section.locator('[data-time-slot]')).toHaveCount(9)
  await expect(section.locator('[data-slot-day="5"] [data-time-slot]')).toHaveText(['12:30'])
  expect((await axe(m)).violations).toEqual([])
  await mctx.close()

  // ---- the Editor reads them, and takes the next free one in a new post
  const ectx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? '',
    timezoneId: 'Europe/Rome',
  })
  const e = await ectx.newPage()
  await ownAddress(e)
  await signIn(e.request, editor)
  await e.goto(`/${org}/spazi/${client.slug}/contenuti`)
  const read = e.locator('[data-content-slots]')
  await expect(read.locator('[data-time-slot]')).toHaveCount(9)
  await expect(read.locator('[data-remove-slot]')).toHaveCount(0)
  await expect(read.getByRole('combobox')).toHaveCount(0)

  const answer = e.waitForResponse((r) => r.url().includes('/next-free-slot'))
  await e.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  const { slot } = (await (await answer).json()) as {
    slot: { localDate: string; localTime: string }
  }
  await e.getByRole('button', { name: 'Prossima fascia libera' }).click()
  await expect(e.locator('[data-when-slot]')).toHaveText(
    'La prima fascia oraria libera del cliente.',
  )
  await expect(e.locator('[data-time-field]')).toContainText(slot.localTime)
  expect(['12:30', '18:00']).toContain(slot.localTime)
  expect((await axe(e)).violations).toEqual([])
  await ectx.close()
})

test('a client without usual times has no «Prossima fascia libera»', async ({ page }) => {
  const owner = await newPerson('Olga Senza', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)
  const client = await newWorkspace(page.request, org, 'Pizzeria')
  const answer = page.waitForResponse((r) => r.url().includes('/next-free-slot'))
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await answer
  await expect(page.locator('[data-when]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Prossima fascia libera' })).toHaveCount(0)
})

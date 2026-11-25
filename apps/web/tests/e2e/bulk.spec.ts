import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { runBulkImportJobs, runMediaProcessJobs } from './support/jobs.ts'
import { assignAccount, connectedAgency, newWorkspace, send } from './support/meta.ts'
import { adminQuery, newPerson, ownAddress, signInWithTotp } from './support/people.ts'

// «In blocco» (spec §11.6, plan 09 Task 10, P5): five files become five rows, two of them a
// carousel, the account for all, the days from the client's usual times; «Programma» makes the
// posts and the summary says each outcome, with «Annulla» for 10 seconds.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
const frame = readFileSync(new URL('./fixtures/frame.jpg', import.meta.url))
/** Five photos with contents of their own, so none is taken for another already sent. */
const photos = Array.from({ length: 5 }, (_, i) => ({
  name: `pane-${String(i + 1)}.jpg`,
  mimeType: 'image/jpeg',
  buffer: Buffer.concat([frame, Buffer.from(`pane ${String(i + 1)}`)]),
}))

/** An Owner of an agency with Forno Luce, its Instagram working, and a usual time every day. */
async function bakery(page: Page) {
  const owner = await newPerson('Olga Blocco', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)
  const client = await newWorkspace(page.request, org, 'Forno Luce')
  const accounts = await adminQuery<{ id: string; platform: string }>(
    "select id, platform from social_accounts where organization_id = $1 and name = 'Forno Luce'",
    [org],
  )
  for (const a of accounts) await assignAccount(page.request, org, client.id, a.id)
  await adminQuery("update social_accounts set health = 'ok' where organization_id = $1", [org])
  await send(page.request, 'PUT', `/api/v1/orgs/${org}/workspaces/${client.id}/time-slots`, {
    slots: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, localTime: '12:30' })),
  })
  const orgId = (
    await adminQuery<{ id: string }>('select id from organizations where slug = $1', [org])
  )[0]?.id
  return { org, orgId: orgId ?? '', client }
}

test('five files: a carousel of two, the account for all, the usual times, «Programma» and «Annulla»', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const { org, orgId, client } = await bakery(page)
  // from «Nuovo post», before the first file
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await page.locator('[data-bulk-entry]').click()
  await expect(page).toHaveURL(/\/post\/in-blocco$/)
  await expect(page.getByRole('heading', { level: 1, name: 'In blocco' })).toBeVisible()
  await expect(page.locator('[data-bulk-drop]')).toBeVisible()
  expect((await axe(page)).violations).toEqual([])

  await page.locator('[data-bulk-input]').setInputFiles(photos)
  const rows = page.locator('[data-bulk-row]')
  await expect(rows).toHaveCount(5)
  // the files on their way keep «Programma» back, and say why
  await expect(page.locator('[data-bulk-schedule]')).toHaveAttribute('aria-disabled', 'true')
  await expect
    .poll(
      async () =>
        (
          await adminQuery<{ n: string }>(
            "select count(*) as n from media where workspace_id = $1 and status in ('processing', 'ready')",
            [client.id],
          )
        )[0]?.n,
      { timeout: 30_000 },
    )
    .toBe('5')
  await runMediaProcessJobs()
  await expect(page.locator('[data-bulk-row][data-problem="sending"]')).toHaveCount(0, {
    timeout: 20_000,
  })

  // the 4th and the 5th, one carousel
  await rows.nth(3).locator('[data-bulk-choose]').click()
  await rows.nth(4).locator('[data-bulk-choose]').click()
  await page.locator('[data-bulk-merge]').click()
  await expect(rows).toHaveCount(4)
  await expect(rows.nth(3).locator('[data-bulk-type]')).toContainText('Carosello')

  // the Instagram for every row, a text on the first
  await page.locator('[data-bulk-account-all]').click()
  await page
    .getByRole('menuitem', { name: /Instagram/ })
    .first()
    .click()
  await expect(page.locator('[data-bulk-row][data-problem]')).toHaveCount(0)
  await rows.nth(0).locator('[data-bulk-caption]').fill('Il pane di segale è tornato')

  // the days from the usual times, in order
  await page.locator('[data-bulk-distribute]').click()
  await expect(page.locator('[data-bulk-undated]')).toHaveCount(0)
  await expect(rows.nth(0)).toContainText('12:30')
  expect((await axe(page)).violations).toEqual([])

  await page.locator('[data-bulk-schedule]').click()
  await expect(page.locator('[data-bulk-summary]')).toBeVisible()
  await runBulkImportJobs(orgId)
  const summary = page.locator('[data-bulk-summary][data-status="done"]')
  await expect(summary).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-bulk-line]')).toContainText('programmati')
  await expect(page.locator('[data-bulk-outcome="todo"]')).toHaveCount(0)
  expect(
    await adminQuery('select id from posts where workspace_id = $1', [client.id]),
  ).toHaveLength(4)

  await page.locator('[data-bulk-undo]').click()
  await expect(page.locator('[data-bulk-summary][data-status="undone"]')).toBeVisible()
  await expect(page.locator('[data-bulk-line]')).toContainText('Tolti 4 post')
  expect(
    await adminQuery('select id from posts where workspace_id = $1', [client.id]),
  ).toHaveLength(0)
  expect((await axe(page)).violations).toEqual([])

  // the table comes back, for another «Programma»
  await page.locator('[data-bulk-again]').click()
  await expect(rows).toHaveCount(4)
})

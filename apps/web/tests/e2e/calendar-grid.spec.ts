import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { META_MOCK } from '@app/meta-mock'
import { libraryFile } from './support/media.ts'
import { connectedAgency, headers, newWorkspace, send } from './support/meta.ts'
import { adminQuery, newPerson, ownAddress, signInWithTotp } from './support/people.ts'

// Instagram's grid (plan 09 Task 12, Scelta 10): the fourth view of the client's calendar, the
// scheduled posts of the next 30 days above the 9 out of the fake Graph API, whose pictures pass
// through the server; two scheduled posts swap their times, dragged or with «Scambia con…»,
// after a confirmation and with «Annulla». The server's clock is the real one: the posts are a
// few days ahead of today.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

/** `days` from today, as the API takes a day and a time in the agency's zone */
const inDays = (days: number, time: string) => ({
  localDate: new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10),
  localTime: time,
})

async function forno(page: Page) {
  const owner = await newPerson('Greta Griglia', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)
  const client = await newWorkspace(page.request, org, 'Caffè Centrale')
  const [account] = await adminQuery<{ id: string }>(
    "select id from social_accounts where organization_id = $1 and platform = 'instagram' and external_id = $2",
    [org, META_MOCK.instagram.shared],
  )
  if (!account) throw new Error('the shared Instagram account was not imported')
  // checked and healthy, as «Sincronizza» leaves it: «Programma» refuses an unchecked account
  await adminQuery("update social_accounts set health = 'ok' where id = $1", [account.id])
  await send(
    page.request,
    'PUT',
    `/api/v1/orgs/${org}/workspaces/${client.id}/accounts/${account.id}`,
  )
  const base = `/api/v1/orgs/${org}/workspaces/${client.id}`
  const scheduled = async (caption: string, days: number, time: string) => {
    const file = await libraryFile(org, client.id, owner.userId, {
      kind: 'image',
      name: `${randomUUID().slice(0, 6)}.jpg`,
    })
    await adminQuery('update media set width = 1080, height = 1350 where id = $1', [file])
    const draft = (await send(page.request, 'POST', `${base}/posts`, {
      type: 'photo',
      caption: { common: caption },
      mediaIds: [file],
      destinations: [{ accountId: account.id }],
      when: inDays(days, time),
    })) as { id: string; version: number }
    const res = await page.request.post(`${base}/posts/${draft.id}/schedule`, {
      headers: headers(),
      data: { version: draft.version },
    })
    expect(res.status(), await res.text()).toBe(200)
    return draft.id
  }
  const near = await scheduled('Il cornetto del mattino', 3, '08:00')
  const far = await scheduled('La torta della domenica', 6, '18:00')
  return { org, client, account: account.id, near, far }
}

const scheduledAt = async (id: string) =>
  (
    await adminQuery<{ scheduled_at: Date }>('select scheduled_at from posts where id = $1', [id])
  )[0]?.scheduled_at.toISOString()

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

test('the grid: the scheduled first, the furthest ahead first, above the posts out', async ({
  page,
}) => {
  const { org, client, near, far } = await forno(page)
  await page.goto(`/${org}/spazi/${client.slug}/calendario`)
  await page.getByRole('button', { name: 'Griglia', exact: true }).click()
  await expect(page).toHaveURL(/vista=griglia/)
  const grid = page.locator('[data-grid]')
  await expect(page.locator('[data-calendar-grid][data-ready]')).toBeVisible()
  await expect(page.locator('[data-grid-account-name]')).toContainText('@caffe.centrale')
  await expect(grid.locator('[data-grid-scheduled]')).toHaveCount(2)
  await expect(grid.locator('[data-grid-scheduled]').nth(0)).toHaveAttribute('data-post', far)
  await expect(grid.locator('[data-grid-scheduled]').nth(1)).toHaveAttribute('data-post', near)
  await expect(grid.locator('[data-grid-published]')).toHaveCount(9)
  // the pictures out come from the server, never from Meta's addresses
  const picture = grid.locator('[data-grid-published] img').first()
  await expect(picture).toHaveAttribute('src', /\/calendar\/grid\/[^/]+\/pictures\/[A-Za-z0-9_-]+$/)
  await expect
    .poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0)
  expect((await axe(page)).violations).toEqual([])
})

test('two scheduled posts swap their times, and «Annulla» puts them back', async ({
  page,
  isMobile,
}) => {
  const { org, client, near, far } = await forno(page)
  const atNear = await scheduledAt(near)
  const atFar = await scheduledAt(far)
  await page.goto(`/${org}/spazi/${client.slug}/calendario?vista=griglia`)
  await expect(page.locator('[data-calendar-grid][data-ready]')).toBeVisible()
  const place = (id: string) => page.locator(`[data-grid-scheduled][data-post="${id}"]`)
  await expect(place(far)).toHaveAttribute('data-movable', 'true')

  if (isMobile) {
    // «Scambia con…» from the «⋯» of a place, the way of the keyboard and the phone
    await place(far).getByRole('button', { name: 'Azioni per La torta della domenica' }).click()
    await page.getByRole('menuitem', { name: 'Scambia con…' }).click()
    const dialog = page.getByRole('dialog', {
      name: 'Scambia l’orario di «La torta della domenica»',
    })
    await dialog.getByRole('radio', { name: /Il cornetto del mattino/ }).check()
    await expect(dialog.locator('[data-grid-swap-summary]')).toContainText(
      '«La torta della domenica» andrà a',
    )
    expect((await axe(page)).violations).toEqual([])
    await dialog.getByRole('button', { name: 'Scambia', exact: true }).click()
  } else {
    await dragOnto(page, place(far).locator('a'), place(near))
    const dialog = page.getByRole('dialog', {
      name: 'Scambia l’orario di «La torta della domenica»',
    })
    await expect(dialog.locator('[data-grid-swap-summary]')).toContainText(
      '«La torta della domenica» andrà a',
    )
    expect((await axe(page)).violations).toEqual([])
    await dialog.getByRole('button', { name: 'Scambia', exact: true }).click()
  }
  const toast = page.locator('[data-toast]')
  await expect(toast).toContainText('Orari scambiati.')
  await expect.poll(() => scheduledAt(far)).toBe(atNear)
  await expect.poll(() => scheduledAt(near)).toBe(atFar)
  // the one that now goes out later takes the first place
  await expect(page.locator('[data-grid-scheduled]').first()).toHaveAttribute('data-post', near)

  await toast.getByRole('button', { name: 'Annulla' }).click()
  await expect(toast).toContainText('Scambio annullato.')
  await expect.poll(() => scheduledAt(far)).toBe(atFar)
  await expect.poll(() => scheduledAt(near)).toBe(atNear)
  await expect(page.locator('[data-grid-scheduled]').first()).toHaveAttribute('data-post', far)
})

test('a connection that stopped working: the scheduled posts, and a word on the ones out', async ({
  page,
}) => {
  const { org, client, far } = await forno(page)
  await adminQuery("update account_connections set status = 'expired' where organization_id = $1", [
    org,
  ])
  await page.goto(`/${org}/spazi/${client.slug}/calendario?vista=griglia`)
  await expect(page.locator('[data-grid-unread]')).toHaveAttribute('data-reason', 'unreachable')
  await expect(page.locator(`[data-grid-scheduled][data-post="${far}"]`)).toBeVisible()
  await expect(page.locator('[data-grid-published]')).toHaveCount(0)
})

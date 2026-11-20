import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { libraryFile } from './support/media.ts'
import { assignAccount, connectedAgency, newWorkspace } from './support/meta.ts'
import {
  addPerson,
  adminQuery,
  newPerson,
  ownAddress,
  signIn,
  signInWithTotp,
} from './support/people.ts'

// «Post», the tab of the client's page (plan 06 Scelta 6, DESIGN.md «Scheda Post del cliente»):
// every post of the client with «Tutti» first, the search, the row that opens the editor, and the
// Viewer who reads the list without thumbnails (D-72).

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

function headers() {
  return { origin: new URL(process.env.E2E_BASE_URL ?? '').origin, 'x-app-request': '1' }
}
async function api(request: APIRequestContext, method: 'POST', path: string, data: unknown) {
  const res = await request.fetch(path, { method, headers: headers(), data })
  expect(res.status(), `${method} ${path}`).toBe(200)
  return (await res.json()) as { id: string; version: number }
}
const ahead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

test('the «Post» tab: all the posts, the filter and the search, a row opens the editor; the Viewer reads it', async ({
  page,
  browser,
}) => {
  const owner = await newPerson('Olga Elenco', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)
  const client = await newWorkspace(page.request, org, 'Forno Luce')
  const [ig] = await adminQuery<{ id: string }>(
    "select id from social_accounts where organization_id = $1 and name = 'Forno Luce' and platform = 'instagram'",
    [org],
  )
  await assignAccount(page.request, org, client.id, ig?.id ?? '')
  await adminQuery("update social_accounts set health = 'ok' where organization_id = $1", [org])
  const pane = await libraryFile(org, client.id, owner.userId, { kind: 'image', name: 'pane.jpg' })
  await libraryFile(org, client.id, owner.userId, { kind: 'image', name: 'sciolto.jpg' })

  const posts = `/api/v1/orgs/${org}/workspaces/${client.id}/posts`
  await api(page.request, 'POST', posts, {
    type: 'photo',
    caption: { common: 'La focaccia del sabato' },
  })
  const going = await api(page.request, 'POST', posts, {
    type: 'photo',
    mediaIds: [pane],
    caption: { common: 'Il pane del lunedì' },
    destinations: [{ accountId: ig?.id ?? '' }],
    when: { localDate: ahead(3), localTime: '18:00' },
  })
  await api(page.request, 'POST', `${posts}/${going.id}/schedule`, { version: going.version })
  const gone = await api(page.request, 'POST', posts, {
    type: 'photo',
    caption: { common: 'Le brioche di Natale' },
  })
  await adminQuery("update posts set status = 'cancelled' where id = $1", [gone.id])

  await page.goto(`/${org}/spazi/${client.slug}`)
  await page
    .getByRole('navigation', { name: 'Sezioni del cliente' })
    .getByRole('link', { name: 'Post', exact: true })
    .click()
  await expect(page).toHaveURL(new RegExp(`/spazi/${client.slug}/post$`))
  const filter = page.getByRole('group', { name: 'Quali post' })
  await expect(filter.getByRole('button', { name: 'Tutti 3' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(filter.getByRole('button', { name: 'Bozze 1' })).toBeVisible()
  await expect(filter.getByRole('button', { name: 'Programmati 1' })).toBeVisible()
  await expect(filter.getByRole('button', { name: 'Annullati 1' })).toBeVisible()
  const rows = page.getByRole('main').getByRole('link', { name: /La focaccia|Il pane|Le brioche/ })
  await expect(rows.filter({ visible: true })).toHaveCount(3)
  expect((await axe(page)).violations).toEqual([])

  await filter.getByRole('button', { name: 'Programmati 1' }).click()
  await expect(rows.filter({ visible: true })).toHaveCount(1)
  await expect(
    page.getByText('Programmato', { exact: true }).filter({ visible: true }),
  ).toBeVisible()
  await filter.getByRole('button', { name: 'Tutti 3' }).click()
  await page.getByRole('searchbox', { name: 'Cerca nel testo o in un profilo' }).fill('focaccia')
  await expect(rows.filter({ visible: true })).toHaveCount(1)
  await rows.filter({ visible: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Bozza' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Testo comune' })).toHaveValue(
    'La focaccia del sabato',
  )

  // the library says which files are in a post, and «Nei post» keeps only those (D-18)
  await page.goto(`/${org}/spazi/${client.slug}/libreria`)
  const tile = (name: string) => page.locator('[data-media-id]').filter({ hasText: name })
  await expect(tile('pane.jpg').locator('[data-used-in]')).toHaveText(/^Nel post di /)
  await expect(tile('sciolto.jpg').locator('[data-used-in]')).toHaveCount(0)
  const inPosts = page.getByRole('button', { name: 'Nei post' })
  await inPosts.click()
  await expect(inPosts).toHaveAttribute('aria-pressed', 'true')
  await expect(tile('sciolto.jpg')).toHaveCount(0)
  await expect(tile('pane.jpg')).toHaveCount(1)
  expect((await axe(page)).violations).toEqual([])

  // the Viewer reads the list, with no thumbnails and no «Nuovo post»
  const viewer = await addPerson(org, 'Vera Vista', 'member', [
    { workspaceId: client.id, role: 'viewer' },
  ])
  const other = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? '' })
  const vera = await other.newPage()
  await ownAddress(vera)
  await signIn(vera.request, viewer)
  await vera.goto(`/${org}/spazi/${client.slug}/post`)
  await expect(vera.getByRole('group', { name: 'Quali post' })).toBeVisible()
  await expect(vera.getByRole('main').locator('img')).toHaveCount(0)
  await expect(vera.getByRole('main').getByRole('link', { name: 'Nuovo post' })).toHaveCount(0)
  await expect(vera.getByText('Tu', { exact: true })).toHaveCount(0)
  await other.close()
})

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

// «Calendario», the tab of the client's page in place of «Post» (plan 09 Task 3, Scelta 2): the
// list with the drafts without a date on top and «Elimina le bozze vuote», the days by time, the
// search, the row that opens the editor, the old address that leads here, and the Viewer who reads
// the list without thumbnails (D-72).

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

test('the «Calendario» tab: the list with the drafts on top, the search, a row opens the editor; the Viewer reads it', async ({
  page,
  browser,
  isMobile,
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
  // an empty draft: no text, files, accounts or date
  await api(page.request, 'POST', posts, { type: 'photo' })
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
  await adminQuery(
    "update posts set status = 'cancelled', scheduled_at = now() + interval '5 days' where id = $1",
    [gone.id],
  )

  await page.goto(`/${org}/spazi/${client.slug}`)
  await page
    .getByRole('navigation', { name: 'Sezioni del cliente' })
    .getByRole('link', { name: 'Calendario', exact: true })
    .click()
  await expect(page).toHaveURL(new RegExp(`/spazi/${client.slug}/calendario$`))
  // the list is the phone's view; on a computer it is one click from the month
  if (!isMobile)
    await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Elenco' }).click()
  const drafts = page.locator('[data-list-drafts]')
  await expect(drafts.locator('[data-post]')).toHaveCount(2)
  await expect(drafts).toContainText('La focaccia del sabato')
  const dated = page.locator('[data-list-group] [data-post]')
  // a cancelled post is not in the calendar unless «Stato» asks for it (Task 2)
  await expect(dated).toHaveCount(1)
  await expect(dated.first()).toContainText('Il pane del lunedì')
  await expect(dated.first()).toContainText('18:00')
  expect((await axe(page)).violations).toEqual([])

  // «Elimina le bozze vuote»: asks, then only the empty one goes
  await drafts.locator('[data-drafts-remove-empty]').click()
  const ask = page.getByRole('dialog', { name: 'Eliminare le bozze vuote?' })
  await ask.locator('[data-drafts-remove-confirm]').click()
  await expect(page.locator('[data-toast]')).toContainText('Eliminata 1 bozza vuota')
  await expect(drafts.locator('[data-post]')).toHaveCount(1)
  await expect(drafts.locator('[data-drafts-remove-empty]')).toHaveCount(0)

  await page.getByRole('searchbox', { name: 'Cerca nel testo', exact: true }).fill('focaccia')
  await expect(dated).toHaveCount(0)
  await expect(drafts.locator('[data-post]')).toHaveCount(1)
  await drafts.locator('[data-post]').click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'La focaccia del sabato' }),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Testo comune' })).toHaveValue(
    'La focaccia del sabato',
  )

  // the old address of «Post» leads to the list
  await page.goto(`/${org}/spazi/${client.slug}/post`)
  await expect(page).toHaveURL(new RegExp(`/spazi/${client.slug}/calendario\\?vista=elenco$`))
  await expect(page.locator('[data-calendar-list]')).toBeVisible()

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

  // the Viewer reads the list, with no thumbnails, no «Nuovo post» and nothing to delete
  const viewer = await addPerson(org, 'Vera Vista', 'member', [
    { workspaceId: client.id, role: 'viewer' },
  ])
  const other = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? '' })
  const vera = await other.newPage()
  await ownAddress(vera)
  await signIn(vera.request, viewer)
  await vera.goto(`/${org}/spazi/${client.slug}/calendario?vista=elenco`)
  await expect(vera.locator('[data-list-group] [data-post]')).toHaveCount(1)
  await expect(vera.getByRole('main').locator('img')).toHaveCount(0)
  await expect(vera.getByRole('main').getByRole('link', { name: 'Nuovo post' })).toHaveCount(0)
  await expect(vera.locator('[data-drafts-remove-empty]')).toHaveCount(0)
  await other.close()
})

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { libraryFile } from './support/media.ts'
import { assignAccount, connectedAgency, newWorkspace, send } from './support/meta.ts'
import { adminQuery, newPerson, ownAddress, signInWithTotp } from './support/people.ts'

// Instagram's collaborators in the panel (plan 09 Scelta 13, Task 15, D-125): «Invita in
// collaborazione» in the editor, the invitation in the preview, and each invitation on the
// page of the outcome with «Aggiorna». The worker does not run here: what it would write is
// written here.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page, isMobile }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 })
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
const shots = process.env.E2E_SCREENSHOTS
const shot = (page: Page, name: string, isMobile: boolean) =>
  shots
    ? page.screenshot({
        path: `${shots}/${name}${isMobile ? '-telefono' : ''}.png`,
        fullPage: true,
      })
    : Promise.resolve()

const accountId = async (org: string, platform: string) =>
  (
    await adminQuery<{ id: string }>(
      "select id from social_accounts where organization_id = $1 and name = 'Forno Luce' and platform = $2",
      [org, platform],
    )
  )[0]?.id ?? ''

/** Forno Luce with its Page and its Instagram, working, and a photo in its library. */
async function client(page: Page) {
  const owner = await newPerson('Carla Collab', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)
  const ws = await newWorkspace(page.request, org, 'Forno Luce')
  const ig = await accountId(org, 'instagram')
  const fb = await accountId(org, 'facebook')
  await assignAccount(page.request, org, ws.id, fb)
  await assignAccount(page.request, org, ws.id, ig)
  await adminQuery("update social_accounts set health = 'ok' where organization_id = $1", [org])
  const photo = await libraryFile(org, ws.id, owner.userId, { kind: 'image', name: 'pane.jpg' })
  return { owner, org, ws, ig, fb, photo }
}

const field = (page: Page) => page.getByRole('textbox', { name: 'Invita in collaborazione' })
const chips = (page: Page) => page.locator('[data-collaborator-chip]')

test('the editor invites up to 3 names, shows them in the preview, and keeps them', async ({
  page,
  isMobile,
}) => {
  const { org, ws, ig, fb, photo } = await client(page)
  const base = `/api/v1/orgs/${org}/workspaces/${ws.id}/posts`
  const draft = (await send(page.request, 'POST', base, {
    type: 'photo',
    mediaIds: [photo],
    caption: { common: 'Pane di segale' },
    destinations: [{ accountId: ig }, { accountId: fb }],
    when: { localDate: '2027-03-01', localTime: '12:30' },
  })) as { id: string }
  await page.goto(`/${org}/spazi/${ws.slug}/post/${draft.id}`)
  const row = page.locator('[data-collaborators]')
  await expect(row).toBeVisible()
  await shot(page, 'editor-collaborazione-vuoto', isMobile)
  await expect(row).toContainText('La richiesta arriva solo su Instagram')

  // written as people write them: with the «@», in capitals, two at once
  const checked = page.waitForResponse((r) => r.url().endsWith('/post-checks'))
  await field(page).fill('@Forno.Luce mulino')
  await field(page).press('Enter')
  await checked
  await expect(chips(page)).toHaveText(['@forno.luce', '@mulino'])
  await expect(row.locator('[data-row-detail]')).toHaveText('2 di 3')
  if (!isMobile)
    await expect(
      page.locator('aside [data-view="instagram_feed"]').getByText('fornoluce e altri 2'),
    ).toBeVisible()
  await shot(page, 'editor-collaborazione', isMobile)
  expect((await axe(page)).violations).toEqual([])

  // the third name fills the field: no room for a fourth
  await field(page).fill('pane_caldo,')
  await expect(chips(page)).toHaveCount(3)
  await expect(field(page)).toHaveCount(0)
  // the field is gone: the focus stays in the row, on the last ×
  await expect(page.getByRole('button', { name: 'Togli pane_caldo dagli invitati' })).toBeFocused()
  // one taken off: the focus goes back to the field
  await page.getByRole('button', { name: 'Togli mulino dagli invitati' }).click()
  await expect(field(page)).toBeFocused()
  await expect(page.locator('[data-save-state]')).toContainText('Bozza salvata alle', {
    timeout: 10_000,
  })
  await expect(page.locator('[data-save-state]')).not.toContainText('Salvataggio')
  await page.reload()
  await expect(chips(page)).toHaveText(['@forno.luce', '@pane_caldo'])

  // a story has no collaborators: the names stay, to be taken off, and the field says why
  await page.locator('[data-type="story"]').click()
  await expect(field(page)).toHaveCount(0)
  await expect(row).toContainText('Le storie non hanno collaboratori')
  await expect(chips(page)).toHaveCount(2)
})

/** A photo out on Instagram with two invitations, as the worker leaves it after confirming. */
async function out(page: Page) {
  const { owner, org, ws, ig, photo } = await client(page)
  const base = `/api/v1/orgs/${org}/workspaces/${ws.id}/posts`
  const draft = (await send(page.request, 'POST', base, {
    type: 'photo',
    mediaIds: [photo],
    caption: { common: 'Pane di segale' },
    destinations: [{ accountId: ig }],
    instagramCollaborators: ['forno.luce', 'mulino'],
  })) as { id: string }
  await adminQuery(
    `update post_targets set status = 'confirmed', generation = generation + 1,
       published_at = now(), external_post_id = '17890000000000001',
       permalink = 'https://www.instagram.com/p/C0llab/',
       meta_ids = '{"platform":"instagram","collaborators":{"names":["forno.luce","mulino"],"dropped":null}}'
     where post_id = $1`,
    [draft.id],
  )
  await adminQuery("update posts set status = 'published' where id = $1", [draft.id])
  return { owner, org, ws, ig, postId: draft.id }
}

test('the outcome tells each invitation, and «Aggiorna» reads the answers again', async ({
  page,
  isMobile,
}) => {
  const { org, ws, ig, postId } = await out(page)
  await page.goto(`/${org}/spazi/${ws.slug}/post/${postId}`)
  const row = page.locator(`[data-outcome-row="${ig}"]`)
  const people = row.locator('[data-outcome-collaborator]')
  await expect(people).toHaveCount(2)
  await expect(people.first()).toContainText('@forno.luce')
  await expect(people.first()).toContainText('Da leggere')

  const refresh = row.locator('[data-outcome-collaborators-refresh]')
  const asked = page.waitForResponse((r) => r.url().endsWith('/collaborators/refresh'))
  await refresh.click()
  expect((await asked).status()).toBe(200)
  // what the worker writes once it has read Meta; the page reads itself a few seconds later
  await adminQuery(`update post_targets set collaborators = $2::jsonb where post_id = $1`, [
    postId,
    JSON.stringify({
      readAt: new Date().toISOString(),
      people: [
        { username: 'forno.luce', status: 'accepted' },
        { username: 'mulino', status: 'pending' },
      ],
    }),
  ])
  await expect(people.first()).toContainText('Accettato', { timeout: 15_000 })
  await expect(people.nth(1)).toContainText('In attesa')
  await expect(row).toContainText('Letto ')
  await shot(page, 'esito-collaborazione', isMobile)
  expect((await axe(page)).violations).toEqual([])
})

test('invitations Instagram refused: the outcome says the post went out without them', async ({
  page,
}) => {
  const { org, ws, ig, postId } = await out(page)
  await adminQuery(
    `update post_targets set meta_ids = jsonb_set(meta_ids, '{collaborators,dropped}', '{"platformCode":"100"}')
     where post_id = $1`,
    [postId],
  )
  await page.goto(`/${org}/spazi/${ws.slug}/post/${postId}`)
  const row = page.locator(`[data-outcome-row="${ig}"]`)
  await expect(row.locator('[data-outcome-collaborator]').first()).toContainText('Non partito')
  await expect(row).toContainText('il post è uscito senza collaboratori')
  await expect(row.locator('[data-outcome-collaborators-refresh]')).toHaveCount(0)
})

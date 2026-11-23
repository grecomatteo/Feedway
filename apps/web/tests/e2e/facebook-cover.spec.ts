import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { createLocalDiskStorage } from '@app/infrastructure'
import { expect, test, type Page } from '@playwright/test'
import { libraryFile } from './support/media.ts'
import { assignAccount, connectedAgency, newWorkspace, send } from './support/meta.ts'
import { adminQuery, newPerson, ownAddress, signInWithTotp } from './support/people.ts'

// The cover of a reel on Facebook in the panel (plan 08 Task 11, D-120.9): Integrazioni → Meta
// says which permissions to add, the outcome says when the cover did not go up, and shows it on
// Facebook when it did. The worker does not run here: what it would write is written here.

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
const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url))
const COVER_SCOPES = ['pages_manage_engagement', 'pages_read_user_content']

const accountId = async (org: string, platform: string) =>
  (
    await adminQuery<{ id: string }>(
      "select id from social_accounts where organization_id = $1 and name = 'Forno Luce' and platform = $2",
      [org, platform],
    )
  )[0]?.id ?? ''

async function agency(page: Page) {
  const owner = await newPerson('Fabio Copertina', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  const { connectionId } = await connectedAgency(page.request, org)
  return { owner, org, connectionId }
}

test('Integrazioni → Meta names the two permissions of the cover, until the token has them', async ({
  page,
  isMobile,
}) => {
  const { org, connectionId } = await agency(page)
  await page.goto(`/${org}/impostazioni/integrazioni/meta`)
  const row = page.locator(`[data-connection="${connectionId}"]`)
  await expect(row).toBeVisible()
  await shot(page, 'integrazioni-permessi', isMobile)
  const note = row.locator('[data-cover-permissions]')
  await expect(note).toContainText('pages_manage_engagement')
  await expect(note).toContainText('pages_read_user_content')
  expect((await axe(page)).violations).toEqual([])
  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(isMobile ? 412 : 1440)

  // the daily check read them: the note goes
  await adminQuery('update account_connections set scopes = scopes || $2::text[] where id = $1', [
    connectionId,
    COVER_SCOPES,
  ])
  await page.reload()
  await expect(row).toBeVisible()
  await expect(row.locator('[data-cover-permissions]')).toHaveCount(0)
})

/** A reel with a cover image, published now on Instagram and Facebook, as the worker leaves it. */
async function reelOut(page: Page, cover: 'done' | 'no_permission' | 'failed') {
  const { owner, org } = await agency(page)
  const client = await newWorkspace(page.request, org, 'Forno Luce')
  const ig = await accountId(org, 'instagram')
  const fb = await accountId(org, 'facebook')
  await assignAccount(page.request, org, client.id, fb)
  await assignAccount(page.request, org, client.id, ig)
  await adminQuery("update social_accounts set health = 'ok' where organization_id = $1", [org])
  const video = await libraryFile(org, client.id, owner.userId, {
    kind: 'video',
    name: 'impasto.mov',
  })
  const image = await libraryFile(org, client.id, owner.userId, {
    kind: 'image',
    name: 'copertina.jpg',
  })
  const base = `/api/v1/orgs/${org}/workspaces/${client.id}/posts`
  const draft = (await send(page.request, 'POST', base, {
    type: 'reel',
    mediaIds: [video],
    cover: { source: 'image', mediaId: image },
    choices: [{ key: `cover_on_facebook:cover:${image}:facebook`, option: 'accept' }],
    caption: { common: "L'impasto della notte" },
    destinations: [{ accountId: ig }, { accountId: fb }],
  })) as { id: string; version: number }
  await send(page.request, 'POST', `${base}/${draft.id}/publish-now`, { version: draft.version })
  // the copies «Pubblica subito» asked for, made as the worker makes them
  const root = process.env.E2E_MEDIA_ROOT
  if (!root) throw new Error('e2e media root not available')
  const storage = createLocalDiskStorage({ root })
  const pending = await adminQuery<{ id: string; storage_key: string; mime: string }>(
    "select id, storage_key, mime from media_variants where organization_id = $1 and status = 'pending'",
    [org],
  )
  for (const c of pending) {
    const isVideo = c.mime === 'video/mp4'
    const bytes = await fixture(isVideo ? 'clip.mp4' : 'frame.jpg')
    await storage.put(c.storage_key, bytes, { contentType: c.mime })
    await adminQuery(
      `update media_variants set status = 'ready', size_bytes = $2, width = 1080, height = 1920
       where id = $1`,
      [c.id, bytes.length],
    )
  }
  for (const [a, ids] of [
    [ig, {}],
    [fb, { platform: 'facebook', cover }],
  ] as const)
    await adminQuery(
      `update post_targets set status = 'confirmed', generation = generation + 1,
         published_at = now(), permalink = 'https://www.facebook.com/reel/7400000000001',
         meta_ids = $3::jsonb
       where post_id = $1 and account_id = $2`,
      [draft.id, a, JSON.stringify(ids)],
    )
  await adminQuery("update posts set status = 'published' where id = $1", [draft.id])
  await page.goto(`/${org}/spazi/${client.slug}/post/${draft.id}`)
  return { fb }
}

test('the outcome says when the cover did not go up on Facebook', async ({ page, isMobile }) => {
  const { fb } = await reelOut(page, 'no_permission')
  const row = page.locator(`[data-outcome-row="${fb}"]`)
  await expect(row).toBeVisible()
  await expect(page.locator('[data-outcome-preview]')).toBeVisible()
  await shot(page, 'esito-copertina-non-caricata', isMobile)
  await expect(row.locator('[data-outcome-cover]')).toHaveText(
    'Copertina non caricata su Facebook: mancano due permessi dell’utente di sistema, il reel ha il primo fotogramma.',
  )
  expect((await axe(page)).violations).toEqual([])
})

test('a cover that went up shows on the Facebook reel of the outcome', async ({
  page,
  isMobile,
}) => {
  const { fb } = await reelOut(page, 'done')
  await expect(page.locator(`[data-outcome-row="${fb}"] [data-outcome-cover]`)).toHaveCount(0)
  const preview = page.locator('[data-outcome-preview]')
  await preview.getByRole('button', { name: 'Facebook' }).click()
  const reel = preview.locator('[data-view="facebook_reel"]')
  await expect(reel).toBeVisible()
  await expect(reel.locator('video')).toHaveAttribute('poster', /\/copies\//)
  if (!isMobile) await shot(page, 'esito-copertina-facebook', isMobile)
})

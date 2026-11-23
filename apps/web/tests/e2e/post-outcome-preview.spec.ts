import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { createLocalDiskStorage } from '@app/infrastructure'
import { expect, test, type Page } from '@playwright/test'
import { libraryFile } from './support/media.ts'
import { assignAccount, connectedAgency, newWorkspace, send } from './support/meta.ts'
import { adminQuery, newPerson, ownAddress, signInWithTotp } from './support/people.ts'

// The page of the outcome as the editor's preview (plan 08 Task 10, D-120 request 1): each
// account's version, a carousel paged with the arrows, a reel from its cover, a story, and the
// originals once the copies are gone. The worker does not run here: the copies it would make
// for «Pubblica subito», and what it would write on the destinations, are written here.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page, isMobile }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
  // the computer at 1440 (plan 08 Task 10); the phone at its own width (Pixel 7, 412)
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 })
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
const shots = process.env.E2E_SCREENSHOTS
const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url))

const accountId = async (org: string, platform: string) =>
  (
    await adminQuery<{ id: string }>(
      "select id from social_accounts where organization_id = $1 and name = 'Forno Luce' and platform = $2",
      [org, platform],
    )
  )[0]?.id ?? ''

async function forno(page: Page) {
  const owner = await newPerson('Olga Anteprima', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)
  const client = await newWorkspace(page.request, org, 'Forno Luce')
  const ig = await accountId(org, 'instagram')
  const fb = await accountId(org, 'facebook')
  await assignAccount(page.request, org, client.id, fb)
  await assignAccount(page.request, org, client.id, ig)
  await adminQuery("update social_accounts set health = 'ok' where organization_id = $1", [org])
  return { owner, org, client, ig, fb }
}

/** The copies «Pubblica subito» asked for, made as the worker makes them. */
async function madeCopies(org: string) {
  const root = process.env.E2E_MEDIA_ROOT
  if (!root) throw new Error('e2e media root not available')
  const storage = createLocalDiskStorage({ root })
  const pending = await adminQuery<{ id: string; storage_key: string; mime: string }>(
    "select id, storage_key, mime from media_variants where organization_id = $1 and status = 'pending'",
    [org],
  )
  for (const c of pending) {
    const video = c.mime === 'video/mp4'
    const bytes = await fixture(video ? 'clip.mp4' : 'frame.jpg')
    await storage.put(c.storage_key, bytes, { contentType: c.mime })
    await adminQuery(
      `update media_variants set status = 'ready', size_bytes = $2, width = 1080, height = $3
       where id = $1`,
      [c.id, bytes.length, video ? 1920 : 1350],
    )
  }
}

async function out(postId: string, accounts: string[]) {
  for (const a of accounts)
    await adminQuery(
      `update post_targets set status = 'confirmed', generation = generation + 1,
         published_at = now(), permalink = 'https://www.instagram.com/p/AbC123/'
       where post_id = $1 and account_id = $2`,
      [postId, a],
    )
  await adminQuery("update posts set status = 'published' where id = $1", [postId])
}

async function publishNow(page: Page, org: string, clientId: string, body: object) {
  const base = `/api/v1/orgs/${org}/workspaces/${clientId}/posts`
  const draft = (await send(page.request, 'POST', base, body)) as { id: string; version: number }
  await send(page.request, 'POST', `${base}/${draft.id}/publish-now`, { version: draft.version })
  return draft.id
}

test('a carousel: each account its version, the arrows page through it', async ({
  page,
  isMobile,
}) => {
  const { owner, org, client, ig, fb } = await forno(page)
  const photos = []
  for (const name of ['pane.jpg', 'focaccia.jpg', 'grissini.jpg'])
    photos.push(await libraryFile(org, client.id, owner.userId, { kind: 'image', name }))
  const postId = await publishNow(page, org, client.id, {
    type: 'carousel',
    mediaIds: photos,
    caption: {
      common: 'Il pane di oggi',
      instagram: 'Il pane di oggi #fornoluce',
      facebook: 'Il pane di oggi, dalle 7 in negozio',
    },
    destinations: [{ accountId: ig }, { accountId: fb }],
  })
  await madeCopies(org)
  await out(postId, [ig, fb])
  await page.goto(`/${org}/spazi/${client.slug}/post/${postId}`)
  const preview = page.locator('[data-outcome-preview]')
  await expect(preview.locator('[data-view="instagram_feed"]')).toBeVisible()
  // the copies that went out, not the originals
  await expect(preview.locator('[data-preview-file] img')).toHaveAttribute('src', /\/copies\//)
  await expect(preview.locator('[data-outcome-originals]')).toHaveCount(0)
  await expect(preview).toContainText('#fornoluce')

  // the keyboard pages through the carousel
  const carousel = preview.locator('[data-preview-carousel]')
  await carousel.focus()
  await expect(carousel).toContainText('1/3')
  await page.keyboard.press('ArrowRight')
  await expect(carousel).toContainText('2/3')
  await page.keyboard.press('ArrowRight')
  await expect(carousel).toContainText('3/3')
  await page.keyboard.press('ArrowLeft')
  await expect(carousel).toContainText('2/3')
  expect((await axe(page)).violations).toEqual([])
  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(isMobile ? 412 : 1440)
  if (shots)
    await page.screenshot({
      path: `${shots}/esito-carosello${isMobile ? '-telefono' : ''}.png`,
      fullPage: true,
    })

  // Facebook: its own text
  await preview.getByRole('button', { name: 'Facebook' }).click()
  await expect(preview.locator('[data-view="facebook_post"]')).toBeVisible()
  await expect(preview).toContainText('dalle 7 in negozio')
  await expect(preview).not.toContainText('#fornoluce')
  if (shots && !isMobile)
    await page.screenshot({ path: `${shots}/esito-carosello-facebook.png`, fullPage: true })
})

test('a reel: the cover chosen on Instagram, the first frame on Facebook', async ({
  page,
  isMobile,
}) => {
  const { owner, org, client, ig, fb } = await forno(page)
  const video = await libraryFile(org, client.id, owner.userId, {
    kind: 'video',
    name: 'impasto.mov',
  })
  const image = await libraryFile(org, client.id, owner.userId, {
    kind: 'image',
    name: 'copertina.jpg',
  })
  const postId = await publishNow(page, org, client.id, {
    type: 'reel',
    mediaIds: [video],
    cover: { source: 'image', mediaId: image },
    // «Su Facebook la copertina è il primo fotogramma»: read and accepted
    choices: [{ key: `cover_on_facebook:cover:${image}:facebook`, option: 'accept' }],
    caption: { common: "L'impasto della notte" },
    destinations: [{ accountId: ig }, { accountId: fb }],
  })
  await madeCopies(org)
  await out(postId, [ig, fb])
  await page.goto(`/${org}/spazi/${client.slug}/post/${postId}`)
  const preview = page.locator('[data-outcome-preview]')
  const reel = preview.locator('[data-view="instagram_reel"]')
  await expect(reel).toBeVisible()
  await expect(reel.locator('video')).toHaveAttribute('src', /\/copies\//)
  await expect(reel.locator('video')).toHaveAttribute('poster', /\/copies\//)
  // it plays in its frame
  await reel.getByRole('button', { name: 'Avvia il video' }).click()
  expect((await axe(page)).violations).toEqual([])
  if (shots)
    await page.screenshot({
      path: `${shots}/esito-reel${isMobile ? '-telefono' : ''}.png`,
      fullPage: true,
    })
  await preview.getByRole('button', { name: 'Facebook' }).click()
  const fbReel = preview.locator('[data-view="facebook_reel"]')
  await expect(fbReel).toBeVisible()
  // Facebook takes the first frame (until Task 11): no cover of ours
  await expect(fbReel.locator('video')).not.toHaveAttribute('poster', /\/copies\//)
})

test('a story, once the copies are gone: the originals, and the page says so', async ({
  page,
  isMobile,
}) => {
  const { owner, org, client, ig } = await forno(page)
  const photo = await libraryFile(org, client.id, owner.userId, {
    kind: 'image',
    name: 'vetrina.jpg',
  })
  const postId = await publishNow(page, org, client.id, {
    type: 'story',
    mediaIds: [photo],
    caption: { common: '' },
    destinations: [{ accountId: ig }],
  })
  await madeCopies(org)
  await out(postId, [ig])
  // the nightly clean-up, 7 days later (plan 07 Scelta 5)
  await adminQuery("delete from media_variants where organization_id = $1 and recipe <> ''", [org])
  await page.goto(`/${org}/spazi/${client.slug}/post/${postId}`)
  const preview = page.locator('[data-outcome-preview]')
  await expect(preview.locator('[data-view="instagram_story"]')).toBeVisible()
  await expect(preview.locator('[data-outcome-originals]')).toHaveText(
    "Le copie pubblicate sono state tolte: questa è l'anteprima dei file originali.",
  )
  await expect(preview.locator('[data-preview-file] img')).toHaveAttribute('src', /\/file\//)
  expect((await axe(page)).violations).toEqual([])
  if (shots)
    await page.screenshot({
      path: `${shots}/esito-storia${isMobile ? '-telefono' : ''}.png`,
      fullPage: true,
    })
})

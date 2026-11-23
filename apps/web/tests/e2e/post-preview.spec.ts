import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { libraryFile } from './support/media.ts'
import { assignAccount, connectedAgency, newWorkspace } from './support/meta.ts'
import { adminQuery, newPerson, ownAddress, signInWithTotp } from './support/people.ts'

// The editor's preview (plan 06 Task 6, spec §11.3; design E4): a tab for each way the post
// goes out, the text of the platform, the choices applied, the zones a reel or a story leaves
// covered, files dropped on it. The accounts come from the fake Graph API (tools/meta-mock).

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
const preview = (page: Page) => page.locator('aside [data-preview]')
const tab = (page: Page, name: string) =>
  preview(page).getByRole('group', { name: 'Come esce' }).getByRole('button', { name })

const accountId = async (org: string, name: string, platform: string) =>
  (
    await adminQuery<{ id: string }>(
      'select id from social_accounts where organization_id = $1 and name = $2 and platform = $3',
      [org, name, platform],
    )
  )[0]?.id ?? ''

/** What the worker read in a file: the checks read it (handoff C). */
async function analysed(id: string, kind: 'image' | 'video', width: number, height: number) {
  const analysis =
    kind === 'image'
      ? { kind, format: 'jpeg', sizeBytes: 2_000_000, width, height, colorSpace: 'srgb' }
      : {
          kind,
          format: 'mp4',
          sizeBytes: 4_000_000,
          width,
          height,
          durationMs: 18_000,
          fps: 30,
          videoCodec: 'h264',
          audioCodec: 'aac',
          faststart: true,
        }
  await adminQuery('update media set width = $2, height = $3, analysis = $4 where id = $1', [
    id,
    width,
    height,
    JSON.stringify({ ...analysis, hasMetadata: false }),
  ])
}

/** Forno Luce with its Page and its Instagram, two photos and a video in its library. */
async function clientWithFiles(page: Page) {
  const owner = await newPerson('Olga Anteprima', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)
  const client = await newWorkspace(page.request, org, 'Forno Luce')
  const ig = await accountId(org, 'Forno Luce', 'instagram')
  const fb = await accountId(org, 'Forno Luce', 'facebook')
  await assignAccount(page.request, org, client.id, fb)
  await assignAccount(page.request, org, client.id, ig)
  await adminQuery("update social_accounts set health = 'ok' where organization_id = $1", [org])
  const add = (kind: 'image' | 'video', name: string) =>
    libraryFile(org, client.id, owner.userId, { kind, name })
  const pane = await add('image', 'pane.jpg')
  const focaccia = await add('image', 'focaccia.jpg')
  const clip = await add('video', 'impasto.mov')
  await analysed(pane, 'image', 1080, 1080)
  await analysed(focaccia, 'image', 1080, 1080)
  await analysed(clip, 'video', 1080, 1920)
  return { owner, org, client, ig, fb }
}

async function pickFromLibrary(page: Page, names: string[]) {
  // on a phone the library is in the menu of «Aggiungi»
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.locator('[data-add-file]').click()
    await page.getByRole('menuitem', { name: 'Dalla libreria' }).click()
  } else await page.getByRole('button', { name: 'Dalla libreria' }).click()
  const dialog = page.getByRole('dialog', { name: 'Scegli dalla libreria' })
  for (const name of names) await dialog.getByRole('button', { name }).click()
  await dialog.getByRole('button', { name: /^Aggiungi/ }).click()
  await expect(dialog).toHaveCount(0)
}

test('a mixed carousel on Instagram and Facebook: only the photos on the Page, its own text, the arrows of the carousel', async ({
  page,
}) => {
  const { org, client } = await clientWithFiles(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  // nothing yet: the preview says what it needs
  await expect(preview(page).locator('[data-preview-empty]')).toBeVisible()

  await pickFromLibrary(page, ['pane.jpg', 'impasto.mov', 'focaccia.jpg'])
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Il pane è tornato #segale')
  await page.getByRole('switch', { name: 'Testo diverso per Instagram e Facebook' }).click()
  await page.getByRole('tab', { name: 'Facebook' }).click()
  await page
    .getByRole('textbox', { name: 'Testo per Facebook' })
    .fill('Sulla Pagina: pane da sabato')

  // the two tabs of the chosen accounts, the feed first: the three files, the hashtag coloured
  await expect(tab(page, 'Feed')).toHaveAttribute('aria-pressed', 'true')
  await expect(tab(page, 'Facebook')).toBeVisible()
  await expect(tab(page, 'Reel')).toHaveCount(0)
  // «Griglia»: the profile's grid with the post first, cut to 3:4, the carousel's sign on it
  await tab(page, 'Griglia').click()
  const first = preview(page).locator('[data-view="instagram_grid"] [data-grid-first]')
  await expect(first.locator('[data-preview-file="0"]')).toBeVisible()
  await expect(first.getByText('Carosello')).toBeAttached()
  const cell = await first.boundingBox()
  expect(cell && Math.abs(cell.height / cell.width - 4 / 3)).toBeLessThan(0.02)
  await tab(page, 'Feed').click()
  const feed = preview(page).locator('[data-view="instagram_feed"]')
  await expect(feed.getByText('1/3')).toBeVisible()
  await expect(feed.locator('[data-mark="hashtag"]')).toHaveText('#segale')

  // Facebook does not take a video in a post with photos: «solo le foto» leaves it out there
  await page.getByRole('radio', { name: /Solo le foto su Facebook/ }).check()
  await tab(page, 'Facebook').click()
  const post = preview(page).locator('[data-view="facebook_post"]')
  await expect(post.locator('[data-preview-file]')).toHaveCount(2)
  await expect(post.locator('[data-preview-caption]')).toHaveText('Sulla Pagina: pane da sabato')
  expect((await axe(page)).violations).toEqual([])

  // back on Instagram the carousel moves with its arrows; the order changes in «File» only, so
  // the column stays short enough for «Controlli» (review of fidelity, A1)
  await tab(page, 'Feed').click()
  await feed.getByRole('button', { name: 'File successivo' }).click()
  await expect(feed.getByText('2/3')).toBeVisible()
  await expect(feed.locator('video')).toHaveCount(1)
  await expect(preview(page).getByRole('button', { name: /^Sposta/ })).toHaveCount(0)
  await feed.getByRole('button', { name: 'File precedente' }).click()

  // on the last file, a file taken out while another tab shows: back on the feed, the first
  await feed.getByRole('button', { name: 'File successivo' }).click()
  await feed.getByRole('button', { name: 'File successivo' }).click()
  await expect(feed.getByText('3/3')).toBeVisible()
  await tab(page, 'Facebook').click()
  await page.locator('[data-entry]').last().focus()
  await page.getByRole('button', { name: 'Togli focaccia.jpg dal post' }).click()
  await tab(page, 'Feed').click()
  await expect(feed.getByText('1/2')).toBeVisible()
  await expect(feed.locator('[data-preview-file]')).toHaveCount(1)
})

test('a tall photo shows in the feed at 4:5, and «Controlli» stand under the preview on a laptop screen', async ({
  page,
}) => {
  const { owner, org, client, fb } = await clientWithFiles(page)
  // a real 2:3 photo (720×1079), not the tiny square of the fixtures: it must not stretch the frame
  const image = await readFile(
    new URL('../../../../design/feedway-ui-assets/adbaa4719c5d6833.jpg', import.meta.url),
  )
  const tall = await libraryFile(org, client.id, owner.userId, {
    kind: 'image',
    name: 'alta.jpg',
    image,
  })
  await analysed(tall, 'image', 720, 1079)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['alta.jpg', 'pane.jpg'])
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Il pane del lunedì')
  const file = preview(page).locator('[data-view="instagram_feed"] [data-preview-file="0"]')
  await expect(file).toBeVisible()
  const box = await file.boundingBox()
  expect(box && Math.abs(box.height / box.width - 5 / 4)).toBeLessThan(0.02)
  // what the app shows under the photo is not the panel's: no likes, no date
  await expect(preview(page).getByText('Piace a 0 persone')).toHaveCount(0)

  // «Controlli» on the first screen, without scrolling the column (screen 08)
  const summary = page.locator('aside #post-summary-title')
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(size)
    await expect(summary).toBeVisible()
    const at = await summary.boundingBox()
    expect(
      at && at.y + at.height,
      `«Controlli» at ${String(size.width)}×${String(size.height)}`,
    ).toBeLessThanOrEqual(size.height)
  }
  expect((await axe(page)).violations).toEqual([])

  // only Instagram: no «Testo diverso per Instagram e Facebook» (screen 09, B5)
  const split = page.getByRole('switch', { name: 'Testo diverso per Instagram e Facebook' })
  await expect(split).toBeVisible()
  await page.locator(`[data-account="${fb}"]`).click()
  await expect(split).toHaveCount(0)
})

test('a story shows no text; a reel shows the zones the app covers when asked, and they go away', async ({
  page,
}) => {
  const { org, client } = await clientWithFiles(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['impasto.mov'])
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Dietro le quinte')
  // a single video: a reel, on both platforms
  await expect(tab(page, 'Reel')).toBeVisible()
  await expect(tab(page, 'Facebook')).toBeVisible()
  const reel = preview(page).locator('[data-view="instagram_reel"]')
  await expect(reel.locator('[data-preview-caption]')).toHaveText('Dietro le quinte')
  // the zones are off at first, the video clean (screen 09, B2); the switch shows them
  await expect(reel.locator('[data-safe-zones]')).toHaveCount(0)
  await preview(page).getByRole('switch', { name: 'Mostra le zone coperte' }).click()
  await expect(reel.locator('[data-safe-zones]')).toBeVisible()
  await expect(reel.getByText("Coperto dall'interfaccia").first()).toBeVisible()
  // a plain 9:16 rectangle (no phone), whole on the screen under the row at the top
  const frame = await preview(page).locator('[data-preview-frame]').boundingBox()
  const bar = await page.locator('[data-editor-bar]').boundingBox()
  expect(frame && Math.abs(frame.height / frame.width - 16 / 9)).toBeLessThan(0.02)
  expect(frame && bar && frame.y).toBeGreaterThanOrEqual((bar?.y ?? 0) + (bar?.height ?? 0))
  expect(frame && frame.y + frame.height).toBeLessThanOrEqual(1000)
  // on a shorter screen the frame narrows to stay whole, under the column's 320 px
  await page.setViewportSize({ width: 1440, height: 760 })
  const short = await preview(page).locator('[data-preview-frame]').boundingBox()
  expect(short?.width).toBeLessThan(300)
  expect(short && Math.abs(short.height / short.width - 16 / 9)).toBeLessThan(0.02)
  expect(short && short.y + short.height).toBeLessThanOrEqual(760)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await preview(page).getByRole('switch', { name: 'Mostra le zone coperte' }).click()
  await expect(reel.locator('[data-safe-zones]')).toHaveCount(0)

  await page.locator('[data-type="story"]').click()
  await expect(tab(page, 'Storia')).toBeVisible()
  await expect(tab(page, 'Facebook')).toBeVisible()
  const story = preview(page).locator('[data-view="instagram_story"]')
  await expect(story).toBeVisible()
  await expect(story.locator('[data-preview-caption]')).toHaveCount(0)
  expect((await axe(page)).violations).toEqual([])
})

test('a file dropped on the preview joins the post; on a phone the preview opens full screen', async ({
  page,
}) => {
  const { org, client } = await clientWithFiles(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await expect(preview(page)).toBeVisible()
  const dropped = await page.evaluateHandle(() => {
    const data = new DataTransfer()
    data.items.add(
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'trascinata.jpg', {
        type: 'image/jpeg',
      }),
    )
    return data
  })
  await preview(page).dispatchEvent('dragover', { dataTransfer: dropped })
  await expect(preview(page).getByText('Rilascia qui per aggiungere i file al post')).toBeVisible()
  await preview(page).dispatchEvent('drop', { dataTransfer: dropped })
  await expect(page.locator('[data-entry]')).toHaveCount(1)
  await expect(page.locator('[data-entry]').first()).toHaveAccessibleName(/trascinata\.jpg/)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('aside [data-preview]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Anteprima' }).click()
  const full = page.getByRole('dialog', { name: 'Anteprima' })
  await expect(full.locator('[data-preview]')).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
  await full.getByRole('button', { name: 'Modifica' }).click()
  await expect(full).toHaveCount(0)
})

// ---- the crop (D-61) and the reel's cover (D-60): plan 06 Task 6, 6b

const cropBox = (page: Page) => page.getByRole('slider', { name: /Riquadro del ritaglio/ })

test('a photo too tall for the feed cropped to 4:5 with the keyboard: the same box after a reload, and on the preview', async ({
  page,
}) => {
  const { owner, org, client } = await clientWithFiles(page)
  const tall = await libraryFile(org, client.id, owner.userId, { kind: 'image', name: 'alta.jpg' })
  await analysed(tall, 'image', 1000, 2000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['alta.jpg'])
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Il bancone')
  const warning = page.locator('[data-outcome="photo_aspect_ratio"]')
  await expect(warning).toBeVisible()
  await warning.getByRole('radio', { name: /Ritaglia/ }).check()
  const dialog = page.getByRole('dialog', { name: 'Ritaglia la foto per il feed' })
  await expect(dialog).toBeVisible()
  // the largest 4:5 box in the middle: full width, from 18,75% of the height
  await expect(cropBox(page)).toHaveAttribute('aria-valuetext', /A 0% da sinistra e 19% dall'alto/)
  await cropBox(page).focus()
  await page.keyboard.press('Shift+ArrowUp')
  await page.keyboard.press('ArrowDown')
  await expect(cropBox(page)).toHaveAttribute('aria-valuetext', /A 0% da sinistra e 10% dall'alto/)
  expect((await axe(page)).violations).toEqual([])
  await dialog.getByRole('button', { name: 'Usa questo ritaglio' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(warning.getByRole('radio', { name: /Ritaglia/ })).toBeChecked()
  // the preview shows only the box
  await expect(
    preview(page).locator('[data-view="instagram_feed"] [data-framing="crop"]'),
  ).toBeVisible()

  await expect(page.locator('[data-save-state]')).toContainText('Bozza salvata alle', {
    timeout: 10_000,
  })
  await expect(page.locator('[data-save-state]')).not.toContainText('Salvataggio')
  await page.reload()
  await page.getByRole('button', { name: 'Modifica il ritaglio' }).click()
  await expect(cropBox(page)).toHaveAttribute('aria-valuetext', /A 0% da sinistra e 10% dall'alto/)
  // «Annulla» leaves the box saved as it was
  await page.getByRole('dialog').getByRole('button', { name: 'Annulla' }).click()
  await expect(warning.getByRole('radio', { name: /Ritaglia/ })).toBeChecked()
})

test('two cropped photos swapped in a carousel: each keeps its own box', async ({ page }) => {
  const { owner, org, client } = await clientWithFiles(page)
  const add = async (name: string) => {
    const id = await libraryFile(org, client.id, owner.userId, { kind: 'image', name })
    await analysed(id, 'image', 1000, 2000)
    return id
  }
  await add('alta-1.jpg')
  await add('alta-2.jpg')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['alta-1.jpg', 'alta-2.jpg'])
  const warning = page.locator('[data-outcome="photo_aspect_ratio"]')
  // Instagram judges the first file of a carousel: crop it at the top
  async function cropTop(times: number) {
    await warning.getByRole('radio', { name: /Ritaglia/ }).check()
    await cropBox(page).focus()
    for (let i = 0; i < times; i++) await page.keyboard.press('Shift+ArrowUp')
    await page.getByRole('button', { name: 'Usa questo ritaglio' }).click()
    await expect(warning.getByRole('radio', { name: /Ritaglia/ })).toBeChecked()
  }
  await cropTop(1)
  await expect(warning).toContainText('File 1')
  // the second first: its own warning, with no answer yet
  await page.locator('[data-entry]').first().focus()
  await page.getByRole('button', { name: 'Sposta dopo alta-1.jpg' }).click()
  await expect(page.locator('[data-entry]').first()).toHaveAccessibleName(/alta-2\.jpg/)
  await expect(warning.getByRole('radio', { name: /Ritaglia/ })).not.toBeChecked()
  await cropTop(2)
  // back: the first photo finds its box again
  await page.locator('[data-entry]').first().focus()
  await page.getByRole('button', { name: 'Sposta dopo alta-2.jpg' }).click()
  await expect(warning.getByRole('radio', { name: /Ritaglia/ })).toBeChecked()
  await page.getByRole('button', { name: 'Modifica il ritaglio' }).click()
  await expect(cropBox(page)).toHaveAttribute('aria-valuetext', /e 9% dall'alto/)
})

test("a reel's cover: a frame with the keyboard, an image dropped, a video refused, back to the first frame", async ({
  page,
}) => {
  const { owner, org, client } = await clientWithFiles(page)
  const cover = await libraryFile(org, client.id, owner.userId, { kind: 'image', name: 'cop.jpg' })
  await analysed(cover, 'image', 1080, 1920)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['impasto.mov'])
  // a reel takes one video: no «Aggiungi», but «Sostituisci» (screen 09, B4)
  const media = page.getByRole('region', { name: 'File' })
  await expect(media.locator('[data-add-file]')).toHaveCount(0)
  await expect(media.getByText('Convertito in MP4')).toBeVisible()
  const other = await libraryFile(org, client.id, owner.userId, {
    kind: 'video',
    name: 'forno.mov',
  })
  await analysed(other, 'video', 1080, 1920)
  await media.getByRole('button', { name: 'Sostituisci il video' }).click()
  await page.getByRole('menuitem', { name: 'Dalla libreria' }).click()
  const library = page.getByRole('dialog', { name: 'Scegli dalla libreria' })
  await library.getByRole('button', { name: 'forno.mov' }).click()
  await library.getByRole('button', { name: /^Aggiungi/ }).click()
  await expect(page.locator('[data-entry]')).toHaveCount(1)
  await expect(page.locator('[data-entry]')).toHaveAccessibleName(/forno\.mov/)
  await expect(page.locator('[data-type="reel"]')).toHaveAttribute('aria-pressed', 'true')
  // and back to the first video, for the cover below; the checks are slow (a slow network):
  // the sentence for Facebook comes from the accounts ticked, not from their answer (D-120.8)
  await page.route('**/post-checks', async (route) => {
    await new Promise((r) => setTimeout(r, 8000))
    await route.continue().catch(() => undefined)
  })
  await media.getByRole('button', { name: 'Sostituisci il video' }).click()
  await page.getByRole('menuitem', { name: 'Dalla libreria' }).click()
  await library.getByRole('button', { name: 'impasto.mov' }).click()
  await library.getByRole('button', { name: /^Aggiungi/ }).click()
  await expect(page.locator('[data-entry]')).toHaveAccessibleName(/impasto\.mov/)
  const section = page.locator('[data-cover]')
  await expect(section.getByRole('heading', { name: 'Copertina' })).toBeVisible()
  // Feedway sends the cover to Instagram only (0.13.0 test): the row says so
  await expect(section.locator('[data-cover-facebook]')).toHaveText(
    'Su Facebook la copertina è il primo fotogramma del video: la copertina scelta va solo su Instagram.',
    { timeout: 3000 },
  )
  await page.unroute('**/post-checks')
  const frame = section.getByRole('slider', { name: 'Scegli un fotogramma' })
  // 18 s at 30 fps: the cursor stops on the last true frame
  await expect(frame).toHaveAttribute('max', '17966')
  await frame.focus()
  await page.keyboard.press('ArrowRight')
  await expect(frame).toHaveAttribute('aria-valuetext', /fotogramma 2 di 539/)
  await page.keyboard.press('Shift+ArrowRight')
  await expect(frame).toHaveAttribute(
    'aria-valuetext',
    /1,0 s · fotogramma 32 di 539|1 s · fotogramma 32 di 539/,
  )
  await expect(section.locator('[data-cover-state]')).toHaveText('Fotogramma a 0:01')
  // «Mostra anche nel feed» on by default
  await expect(section.getByRole('switch', { name: 'Mostra anche nel feed' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  expect((await axe(page)).violations).toEqual([])

  // a video dropped on the cover is refused at once
  const drop = async (name: string, type: string) => {
    const data = await page.evaluateHandle(
      (f) => {
        const d = new DataTransfer()
        d.items.add(new File([new Uint8Array([0, 0, 0, 24])], f.name, { type: f.type }))
        return d
      },
      { name, type },
    )
    await section.locator('[data-cover-drop]').dispatchEvent('drop', { dataTransfer: data })
  }
  await drop('altro.mov', 'video/quicktime')
  await expect(section.getByRole('alert')).toHaveText(
    "altro.mov è un video: la copertina può essere solo un'immagine.",
  )

  // an image from the library becomes the cover
  await section.getByRole('button', { name: "Carica un'immagine" }).click()
  await page.getByRole('menuitem', { name: 'Dalla libreria' }).click()
  const dialog = page.getByRole('dialog', { name: 'Scegli dalla libreria' })
  await dialog.getByRole('button', { name: 'cop.jpg' }).click()
  await dialog.getByRole('button', { name: /^Aggiungi/ }).click()
  await expect(section.locator('[data-cover-state]')).toHaveText('Immagine caricata')
  await section.getByRole('button', { name: 'Ripristina' }).click()
  await expect(section.locator('[data-cover-state]')).toHaveText('Fotogramma a 0:00')
  await expect(frame).toHaveAttribute('aria-valuetext', /fotogramma 1 di 539/)
})

test('a cover cropped, then changed: the box of the old photo does nothing, the checks stay true (P2 of the review)', async ({
  page,
}) => {
  const { owner, org, client } = await clientWithFiles(page)
  for (const [name, width, height] of [
    ['alta.jpg', 1080, 1350],
    ['quadra.jpg', 1080, 1080],
  ] as const) {
    const id = await libraryFile(org, client.id, owner.userId, { kind: 'image', name })
    await analysed(id, 'image', width, height)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['impasto.mov'])
  const section = page.locator('[data-cover]')
  async function pickCover(name: string) {
    await section.getByRole('button', { name: "Carica un'immagine" }).click()
    await page.getByRole('menuitem', { name: 'Dalla libreria' }).click()
    const library = page.getByRole('dialog', { name: 'Scegli dalla libreria' })
    await library.getByRole('button', { name }).click()
    await library.getByRole('button', { name: /^Aggiungi/ }).click()
    await expect(library).toHaveCount(0)
  }
  const warning = page.locator('[data-outcome="cover_aspect_ratio"]')
  const cropOption = warning.getByRole('radio', { name: /Ritaglia/ })
  const dialog = page.getByRole('dialog', { name: 'Ritaglia la copertina del reel' })
  const failed = page.getByText('Controlli non riusciti')

  await pickCover('alta.jpg')
  await cropOption.check()
  await expect(dialog).toContainText('1080×1350')
  await dialog.getByRole('button', { name: 'Usa questo ritaglio' }).click()
  await expect(cropOption).toBeChecked()

  // another photo: the warning is about it, to answer again, and the checks did not fail
  await pickCover('quadra.jpg')
  await expect(cropOption).not.toBeChecked()
  await expect(failed).toHaveCount(0)
  await cropOption.check()
  await expect(dialog).toContainText('1080×1080')
  await dialog.getByRole('button', { name: 'Usa questo ritaglio' }).click()
  await expect(cropOption).toBeChecked()
  await expect(failed).toHaveCount(0)
})

test('a choice to make comes before the preview, whole on a laptop screen, and «Programma» leads to it', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'the column of the computer')
  const { owner, org, client, ig } = await clientWithFiles(page)
  const wide = await libraryFile(org, client.id, owner.userId, { kind: 'video', name: 'sala.mov' })
  await analysed(wide, 'video', 1920, 1080)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['sala.mov'])
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('La sala di sera')
  await page.locator(`[data-account="${ig}"]`).click()
  const choice = page.locator('aside [data-outcome="reel_aspect_ratio"]')
  await expect(choice).toBeVisible()

  // the checks first in the column, every option on the screen without scrolling it (09)
  await expect(page.locator('aside [data-checks-first]')).toHaveCount(1)
  const options = choice.getByRole('radio')
  await expect(options).toHaveCount(3)
  for (const option of await options.all()) {
    const box = await option.boundingBox()
    expect(box && box.y + box.height).toBeLessThanOrEqual(800)
  }
  // each option draws what it does to the video
  await expect(choice.locator('[data-choice-sketch]')).toHaveCount(3)

  // «Programma» reads as off, and a click on it goes to the choice
  const schedule = page.locator('[data-schedule]').filter({ visible: true }).first()
  await expect(schedule).toBeDisabled()
  await schedule.click({ force: true })
  await expect(options.first()).toBeFocused()

  // answered, the checks stay where they are: the option does not jump away under the pointer
  await choice.getByRole('radio', { name: /Intero, con le bande/ }).check()
  await expect(page.locator('aside [data-checks-first]')).toHaveCount(1)
  await expect(schedule).toBeEnabled()
  expect((await axe(page)).violations).toEqual([])
})

test('«Programma» leads to the choice still to make, not to one already answered', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'the column of the computer')
  const { owner, org, client } = await clientWithFiles(page)
  // a carousel opened by a photo too tall for the feed, then a square one: two warnings
  const tall = await libraryFile(org, client.id, owner.userId, { kind: 'image', name: 'alta.jpg' })
  await analysed(tall, 'image', 1000, 2000)
  const square = await libraryFile(org, client.id, owner.userId, {
    kind: 'image',
    name: 'quadrata.jpg',
  })
  await analysed(square, 'image', 1000, 1000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['alta.jpg', 'quadrata.jpg'])
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Il bancone')
  // Instagram is already ticked for photos
  await expect(page.getByRole('checkbox', { name: /Instagram/ })).toBeChecked()
  const first = page.locator('aside [data-outcome="photo_aspect_ratio"]')
  const second = page.locator('aside [data-outcome="carousel_mixed_ratios"]')
  await expect(first).toBeVisible()
  await expect(second).toBeVisible()

  // the first one answered, the second one still open
  await first.getByRole('radio').nth(1).check()
  await expect(first).not.toHaveAttribute('data-unresolved')
  const schedule = page.locator('[data-schedule]').filter({ visible: true }).first()
  await expect(schedule).toBeDisabled()
  await schedule.click({ force: true })
  await expect(second.getByRole('radio').first()).toBeFocused()
})

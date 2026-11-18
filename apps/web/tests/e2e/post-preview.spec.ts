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
  await page.getByRole('button', { name: 'Dalla libreria' }).click()
  const dialog = page.getByRole('dialog', { name: 'Scegli dalla libreria' })
  for (const name of names) await dialog.getByRole('button', { name }).click()
  await dialog.getByRole('button', { name: /^Aggiungi/ }).click()
  await expect(dialog).toHaveCount(0)
}

test('a mixed carousel on Instagram and Facebook: only the photos on the Page, its own text, the order changed from the preview', async ({
  page,
}) => {
  const { org, client } = await clientWithFiles(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  // nothing yet: the preview says what it needs
  await expect(preview(page).locator('[data-preview-empty]')).toBeVisible()

  await pickFromLibrary(page, ['pane.jpg', 'impasto.mov', 'focaccia.jpg'])
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Il pane è tornato #segale')
  await page.getByRole('switch', { name: 'Testo diverso per piattaforma' }).click()
  await page.getByRole('tab', { name: 'Facebook' }).click()
  await page
    .getByRole('textbox', { name: 'Testo per Facebook' })
    .fill('Sulla Pagina: pane da sabato')

  // the two tabs of the chosen accounts, the feed first: the three files, the hashtag coloured
  await expect(tab(page, 'Instagram · feed')).toHaveAttribute('aria-pressed', 'true')
  await expect(tab(page, 'Facebook · post')).toBeVisible()
  await expect(tab(page, 'Instagram · reel')).toHaveCount(0)
  const feed = preview(page).locator('[data-view="instagram_feed"]')
  await expect(feed.getByText('1/3')).toBeVisible()
  await expect(feed.locator('[data-mark="hashtag"]')).toHaveText('#segale')

  // Facebook does not take a video in a post with photos: «solo le foto» leaves it out there
  await page.getByRole('radio', { name: /Solo le foto su Facebook/ }).check()
  await tab(page, 'Facebook · post').click()
  const post = preview(page).locator('[data-view="facebook_post"]')
  await expect(post.locator('[data-preview-file]')).toHaveCount(2)
  await expect(post.locator('[data-preview-caption]')).toHaveText('Sulla Pagina: pane da sabato')
  expect((await axe(page)).violations).toEqual([])

  // back on Instagram, the second file (the video) moves first from the preview
  await tab(page, 'Instagram · feed').click()
  await feed.getByRole('button', { name: 'File successivo' }).click()
  await expect(feed.getByText('2/3')).toBeVisible()
  await feed.getByRole('button', { name: 'Sposta prima' }).click()
  await expect(page.locator('[data-entry]').first()).toHaveAccessibleName(/File 1: impasto\.mov/)
})

test('a story shows no text and the zones the app covers; a reel the same, and the zones go away', async ({
  page,
}) => {
  const { org, client } = await clientWithFiles(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['impasto.mov'])
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Dietro le quinte')
  // a single video: a reel, on both platforms
  await expect(tab(page, 'Instagram · reel')).toBeVisible()
  await expect(tab(page, 'Facebook · reel')).toBeVisible()
  const reel = preview(page).locator('[data-view="instagram_reel"]')
  await expect(reel.locator('[data-preview-caption]')).toHaveText('Dietro le quinte')
  await expect(reel.locator('[data-safe-zones]')).toBeVisible()
  await expect(reel.getByText("Coperto dall'interfaccia").first()).toBeVisible()
  await preview(page).getByRole('switch', { name: 'Mostra le zone coperte' }).click()
  await expect(reel.locator('[data-safe-zones]')).toHaveCount(0)

  await page.locator('[data-type="story"]').click()
  await expect(tab(page, 'Instagram · storia')).toBeVisible()
  await expect(tab(page, 'Facebook · storia')).toBeVisible()
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
  const section = page.locator('[data-cover]')
  await expect(section.getByRole('heading', { name: 'Copertina del reel' })).toBeVisible()
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
  await expect(section.locator('[data-cover-state]')).toHaveText(/Fotogramma 1(,0)? s/)
  // «Mostra anche nel feed» on by default
  await expect(section.getByRole('switch', { name: 'Mostra anche nel feed' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  expect((await axe(page)).violations).toEqual([])

  // a video dropped on the cover is refused at once
  const drop = async (name: string, type: string) => {
    const data = await page.evaluateHandle(
      ([n, t]) => {
        const d = new DataTransfer()
        d.items.add(new File([new Uint8Array([0, 0, 0, 24])], n, { type: t }))
        return d
      },
      [name, type],
    )
    await section.locator('[data-cover-drop]').dispatchEvent('drop', { dataTransfer: data })
  }
  await drop('altro.mov', 'video/quicktime')
  await expect(section.getByRole('alert')).toHaveText(
    "altro.mov è un video: la copertina può essere solo un'immagine.",
  )

  // an image from the library becomes the cover
  await section.getByRole('button', { name: 'Dalla libreria' }).click()
  const dialog = page.getByRole('dialog', { name: 'Scegli dalla libreria' })
  await dialog.getByRole('button', { name: 'cop.jpg' }).click()
  await dialog.getByRole('button', { name: /^Aggiungi/ }).click()
  await expect(section.locator('[data-cover-state]')).toHaveText('Immagine caricata')
  await section.getByRole('button', { name: 'Ripristina' }).click()
  await expect(section.locator('[data-cover-state]')).toHaveText('Fotogramma 0 s')
  await expect(frame).toHaveAttribute('aria-valuetext', /fotogramma 1 di 539/)
})

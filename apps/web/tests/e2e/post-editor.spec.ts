import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
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

// The editor of a post (plan 06 Task 5, spec §11.2, §11.9; brief F02; design E1–E6): the type
// that follows the files until the person chooses, the files in their order, the text per
// platform, the accounts, the date, the draft that saves itself, the summary with its warnings
// and blocks, and who may do what. The accounts come from the fake Graph API (tools/meta-mock).

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
const saveState = (page: Page) => page.locator('[data-save-state]')
const scheduleButton = (page: Page) => page.locator('[data-schedule]')

const accountId = async (org: string, name: string, platform: string) =>
  (
    await adminQuery<{ id: string }>(
      'select id from social_accounts where organization_id = $1 and name = $2 and platform = $3',
      [org, name, platform],
    )
  )[0]?.id ?? ''

/** An agency with Forno Luce, its Page and its Instagram (working), and two photos in its library. */
async function clientWithFiles(page: Page) {
  const owner = await newPerson('Olga Post', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)
  const client = await newWorkspace(page.request, org, 'Forno Luce')
  const ig = await accountId(org, 'Forno Luce', 'instagram')
  const fb = await accountId(org, 'Forno Luce', 'facebook')
  await assignAccount(page.request, org, client.id, fb)
  await assignAccount(page.request, org, client.id, ig)
  // a seeded account has no health yet, which the checks block
  await adminQuery("update social_accounts set health = 'ok' where organization_id = $1", [org])
  const pane = await libraryFile(org, client.id, owner.userId, { kind: 'image', name: 'pane.jpg' })
  const focaccia = await libraryFile(org, client.id, owner.userId, {
    kind: 'image',
    name: 'focaccia.jpg',
  })
  return { owner, org, client, ig, fb, files: { pane, focaccia } }
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

test('a carousel from the library, reordered, a text for Instagram, one account less: all there after a reload', async ({
  page,
}) => {
  const { org, client, fb } = await clientWithFiles(page)
  await page.goto(`/${org}/spazi/${client.slug}`)
  // the shell's «Nuovo post» writes for the client that is open (D-89)
  await page.getByRole('link', { name: 'Nuovo post' }).locator('visible=true').click()
  await expect(page).toHaveURL(/\/post\/nuovo$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Nuovo post' })).toBeVisible()
  // no file: the four types, none chosen; nothing saved yet
  await expect(page.locator('[data-type][aria-pressed="true"]')).toHaveCount(0)
  await expect(saveState(page)).toContainText('si salva da sola')
  expect((await axe(page)).violations).toEqual([])

  await pickFromLibrary(page, ['pane.jpg', 'focaccia.jpg'])
  // two files: Carosello by itself, Foto and Reel off, why in one sentence read with them
  await expect(page.locator('[data-type="carousel"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-type="photo"]')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.locator('[data-type="photo"]')).toHaveAccessibleDescription(
    'Con 2 file si può fare solo un carosello.',
  )
  await expect(page.getByRole('region', { name: 'File' })).toContainText('2 di 10')
  // the draft is born with its first content, and the address becomes the post's
  await expect(saveState(page)).toContainText('Bozza salvata alle', { timeout: 10_000 })
  await expect(page).toHaveURL(/\/post\/[0-9a-f-]{36}$/)

  // the order with the keyboard: the first file goes after the second
  await page.locator('[data-entry]').first().focus()
  await page.getByRole('button', { name: 'Sposta dopo pane.jpg' }).click()
  await expect(page.locator('[data-entry]').first()).toHaveAccessibleName(/File 1: focaccia\.jpg/)

  // a text of its own for Instagram
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Il pane di segale è tornato')
  await page.getByRole('switch', { name: 'Testo diverso per Instagram e Facebook' }).click()
  await page.getByRole('tab', { name: 'Instagram' }).click()
  await page
    .getByRole('textbox', { name: 'Testo per Instagram' })
    .fill('Il pane di segale è tornato #panedisegale')
  await expect(page.locator('[data-counters]').first()).toContainText('1 di 30 hashtag')

  // the Page off: only Instagram
  await page.locator(`[data-account="${fb}"]`).click()
  await expect(
    page.locator('section[aria-labelledby="post-destinations"] [data-row-detail]'),
  ).toHaveText(/^1 di \d+$/)
  await expect(saveState(page)).toContainText('Bozza salvata alle', { timeout: 10_000 })
  // let the last change reach the server before the reload
  await expect(saveState(page)).not.toContainText('Salvataggio')

  await page.reload()
  // the tab of a saved post is «Modifica il post», whatever its state (D-80.6)
  await expect(page).toHaveTitle(/^Modifica il post · Forno Luce/)
  // a draft is named by the start of its text (review of fidelity, B12)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Il pane di segale è tornato' }),
  ).toBeVisible()
  await expect(page.locator('[data-entry]').first()).toHaveAccessibleName(/File 1: focaccia\.jpg/)
  await expect(page.locator('[data-type="carousel"]')).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('tab', { name: 'Instagram' }).click()
  await expect(page.getByRole('textbox', { name: 'Testo per Instagram' })).toHaveValue(
    'Il pane di segale è tornato #panedisegale',
  )
  await expect(page.locator(`[data-account="${fb}"]`)).not.toBeChecked()
  expect((await axe(page)).violations).toEqual([])
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('at most 10 files: the library stops at 10, and the files over them are left out (D-118)', async ({
  page,
}) => {
  const { owner, org, client } = await clientWithFiles(page)
  const more = Array.from({ length: 9 }, (_, i) => `foto-${String(i + 1)}.jpg`)
  for (const name of more) await libraryFile(org, client.id, owner.userId, { kind: 'image', name })
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)

  await pickFromLibrary(page, ['pane.jpg'])
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.locator('[data-add-file]').click()
    await page.getByRole('menuitem', { name: 'Dalla libreria' }).click()
  } else await page.getByRole('button', { name: 'Dalla libreria' }).click()
  const dialog = page.getByRole('dialog', { name: 'Scegli dalla libreria' })
  await expect(dialog.locator('[data-picker-room]')).toHaveText(
    'Puoi sceglierne ancora 9: un post ha al massimo 10 file.',
  )
  for (const name of more) await dialog.getByRole('button', { name }).click()
  await expect(dialog.locator('[data-picker-room]')).toHaveText(
    'Hai scelto tutti i file che il post può avere: al massimo 10.',
  )
  // the 11th cannot be ticked
  const focaccia = dialog.getByRole('button', { name: 'focaccia.jpg' })
  await expect(focaccia).toHaveAttribute('aria-disabled', 'true')
  await focaccia.click({ force: true })
  await expect(focaccia).toHaveAttribute('aria-pressed', 'false')
  expect((await axe(page)).violations).toEqual([])
  // one ticked off: one place again; 9 files go in
  await dialog.getByRole('button', { name: 'foto-9.jpg' }).click()
  await expect(dialog.locator('[data-picker-room]')).toHaveText(
    'Puoi sceglierne ancora uno: un post ha al massimo 10 file.',
  )
  await dialog.getByRole('button', { name: 'Aggiungi 8 file' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[data-entry]')).toHaveCount(9)

  // three files for the last place: the one the browser refuses takes none, the second goes
  // in, the third is left out and said
  const jpeg = await readFile(new URL('./fixtures/frame.jpg', import.meta.url))
  await page.locator('[data-post-input]').setInputFiles([
    { name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('ciao') },
    { name: 'forno.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    { name: 'vetrina.jpg', mimeType: 'image/jpeg', buffer: jpeg },
  ])
  await expect(page.locator('[data-media-left-out]')).toHaveText(
    'Un file non aggiunto: un post ha al massimo 10 file.',
  )
  await expect(page.getByRole('alert').filter({ hasText: 'nota.txt' })).toBeVisible()
  await expect(page.locator('[data-entry]')).toHaveCount(10)
  await expect(page.locator('[data-entry]').last()).toHaveAccessibleName(/forno\.jpg/)

  const files = page.getByRole('region', { name: 'File' })
  await expect(files).toContainText('10 di 10')
  await expect(page.locator('[data-add-file]')).toBeDisabled()
  await expect(page.locator('[data-media-full]')).toHaveText(
    'Il post ha già 10 file, il massimo. Per aggiungerne un altro, togline uno.',
  )
  expect((await axe(page)).violations).toEqual([])

  // one taken out: there is room again
  await page.locator('[data-entry]').first().focus()
  await page.getByRole('button', { name: 'Togli pane.jpg dal post' }).click()
  await expect(page.locator('[data-add-file]')).toBeEnabled()
  await expect(page.locator('[data-media-left-out]')).toHaveCount(0)
})

test('schedule, back to draft, cancel: the actions of a Publisher and up', async ({ page }) => {
  const { org, client } = await clientWithFiles(page)
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['pane.jpg'])
  await expect(page.locator('[data-type="photo"]')).toHaveAttribute('aria-pressed', 'true')
  // the date proposed is ahead, in the panel's own fields (never the browser's); Rome, the
  // default zone, is not said (Matteo 18/11)
  await expect(page.locator('input[type="date"], input[type="time"]')).toHaveCount(0)
  await expect(page.locator('[data-day-field]')).toHaveAccessibleName(
    /^Giorno: \p{L}+ \d{1,2} \p{L}+/u,
  )
  await expect(page.locator('[data-time-field]')).toHaveAccessibleName(/^Ora: \d{1,2}:\d\d$/)
  // the next day with the keyboard, then an hour written as people write it
  const day = await page.locator('[data-day-field]').getAttribute('aria-label')
  await page.locator('[data-day-field]').click()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-day-field]')).not.toHaveAccessibleName(day ?? '')
  await page.locator('[data-time-field]').click()
  await page.getByRole('textbox', { name: "Scrivi un'ora" }).fill('1830')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-time-field]')).toHaveAccessibleName('Ora: 18:30')
  // two accounts: no search, «Gruppi» or «Seleziona tutti» above them (from six up)
  await expect(page.locator('[data-destinations-tools]')).toHaveCount(0)
  await expect(page.getByText(/ora di Roma/)).toHaveCount(0)
  await expect(scheduleButton(page)).toBeEnabled({ timeout: 15_000 })
  await expect(scheduleButton(page)).toHaveText(/Programma su 2 account/)
  await scheduleButton(page).click()
  // back to the client's posts, with the confirmation and the way back to the post (screen 12)
  await expect(page).toHaveURL(new RegExp(`/spazi/${client.slug}/post$`))
  const toast = page.locator('[data-toast]')
  await expect(toast).toContainText(/Programmato per \p{L}+ \d{1,2} \p{L}+( \d{4})? alle 18:30/u)
  await toast.getByRole('link', { name: 'Apri' }).click()
  // followed, the confirmation goes: on a phone it would cover the editor's buttons
  await expect(toast).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: 'Post programmato' })).toBeVisible()

  // a change not saved yet is kept when the post goes back to draft
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Il pane del martedì')
  await page.getByRole('button', { name: 'Riporta in bozza' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Il pane del martedì' })).toBeVisible()
  await expect(saveState(page)).toContainText('Bozza salvata alle', { timeout: 10_000 })
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Testo comune' })).toHaveValue(
    'Il pane del martedì',
  )
  await expect(scheduleButton(page)).toBeEnabled({ timeout: 15_000 })
  await scheduleButton(page).click()
  await expect(page).toHaveURL(new RegExp(`/spazi/${client.slug}/post$`))
  await page.locator('[data-toast]').getByRole('link', { name: 'Apri' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Post programmato' })).toBeVisible()
  await page.getByRole('button', { name: 'Annulla programmazione' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Annulla programmazione' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Post annullato' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Elimina post' })).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
})

test('a reel too short is blocked, and «Programma» stays off', async ({ page }) => {
  const { org, client, owner } = await clientWithFiles(page)
  const clip = await libraryFile(org, client.id, owner.userId, { kind: 'video', name: 'corto.mov' })
  // the checks read what the worker found in the file
  await adminQuery('update media set duration_ms = 2000, analysis = $2 where id = $1', [
    clip,
    JSON.stringify({
      kind: 'video',
      format: 'mp4',
      sizeBytes: 4_000_000,
      width: 1080,
      height: 1920,
      durationMs: 2000,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      faststart: true,
    }),
  ])
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['corto.mov'])
  await expect(page.locator('[data-type="reel"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-outcome="reel_too_short"]')).toBeVisible({ timeout: 15_000 })
  await expect(scheduleButton(page)).toBeDisabled()
  await expect(page.getByRole('button', { name: /Risolvi/ })).toBeVisible()
})

test('a file still being prepared: «In attesa del file 2», no false blocks (D-80.1)', async ({
  page,
}) => {
  const { org, client, owner } = await clientWithFiles(page)
  await libraryFile(org, client.id, owner.userId, {
    kind: 'video',
    name: 'forno.mov',
    status: 'processing',
  })
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['pane.jpg', 'forno.mov'])
  await expect(page.locator('[data-type="carousel"]')).toHaveAttribute('aria-pressed', 'true')
  const summary = page.locator('[data-checks]').locator('visible=true')
  await expect(summary.locator('[data-outcome="media_processing"]')).toHaveText(
    /In attesa del file 2/,
    { timeout: 15_000 },
  )
  // the carousel counts the file, Facebook's choice about the video waits for it
  await expect(summary.locator('[data-outcome="carousel_too_few"]')).toHaveCount(0)
  await expect(summary.locator('[data-outcome="carousel_mixed_with_facebook"]')).toHaveCount(0)
  await expect(summary.locator('[data-missing]')).toHaveCount(0)
  await expect(summary).toContainText('In attesa di 1 file')
  await expect(scheduleButton(page)).toBeDisabled()
})

test('a post of an archived client: the summary says why, never «Controlli non riusciti» (D-80.5)', async ({
  page,
}) => {
  const { org, client, files } = await clientWithFiles(page)
  const made = await page.request.post(`/api/v1/orgs/${org}/workspaces/${client.id}/posts`, {
    headers: { origin: new URL(process.env.E2E_BASE_URL ?? '').origin, 'x-app-request': '1' },
    data: { type: 'photo', caption: { common: 'Il pane di oggi' }, mediaIds: [files.pane] },
  })
  expect(made.ok()).toBe(true)
  const { id } = (await made.json()) as { id: string }
  await adminQuery('update workspaces set archived_at = now() where id = $1', [client.id])
  await page.goto(`/${org}/spazi/${client.slug}/post/${id}`)
  const summary = page.locator('[data-checks]').locator('visible=true')
  await expect(summary.locator('[data-archived]')).toHaveText(
    'Il cliente è archiviato: non si programmano post.',
  )
  await expect(summary).not.toContainText('Controlli non riusciti')
})

test('a saved draft without text is «Bozza senza testo»; the preview follows the theme (D-102.5, D-102.10)', async ({
  page,
  isMobile,
}) => {
  const { org, client } = await clientWithFiles(page)
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await expect(page.getByRole('heading', { level: 1, name: 'Nuovo post' })).toBeVisible()
  await pickFromLibrary(page, ['pane.jpg'])
  await expect(saveState(page)).toContainText('Bozza salvata alle', { timeout: 10_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Bozza senza testo' })).toBeVisible()

  test.skip(isMobile, 'the preview is beside the form on a computer')
  const frame = page.locator('aside [data-preview] [data-preview-frame]')
  await expect(frame).toHaveAttribute('data-preview-app', 'instagram')
  const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  await expect(frame).toHaveCSS('background-color', dark ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)')
})

test('a warning to answer: the choice is saved, then the post can be scheduled', async ({
  page,
}) => {
  const { org, client, owner } = await clientWithFiles(page)
  const tall = await libraryFile(org, client.id, owner.userId, { kind: 'image', name: 'alta.jpg' })
  // 1080×2160: too tall for the feed of Instagram (4:5 at most)
  await adminQuery('update media set width = 1080, height = 2160, analysis = $2 where id = $1', [
    tall,
    JSON.stringify({
      kind: 'image',
      format: 'jpeg',
      sizeBytes: 2_000_000,
      width: 1080,
      height: 2160,
      colorSpace: 'srgb',
      hasMetadata: false,
    }),
  ])
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['alta.jpg'])
  const warning = page.locator('[data-outcome="photo_aspect_ratio"]')
  await expect(warning).toBeVisible({ timeout: 15_000 })
  await expect(scheduleButton(page)).toBeDisabled()
  await warning.getByRole('radio', { name: /Aggiungi le bande/ }).check()
  await expect(scheduleButton(page)).toBeEnabled({ timeout: 15_000 })
  await expect(saveState(page)).toContainText('Bozza salvata alle', { timeout: 10_000 })
  // the address follows the draft right after its first save
  await expect(page).not.toHaveURL(/\/post\/nuovo/)
  await page.reload()
  await expect(
    page
      .locator('[data-outcome="photo_aspect_ratio"]')
      .getByRole('radio', { name: /Aggiungi le bande/ }),
  ).toBeChecked({ timeout: 15_000 })
})

test('an Editor only saves drafts, and sees a draft of another without changing it', async ({
  page,
  browser,
}) => {
  const { org, client } = await clientWithFiles(page)
  // the Owner's draft
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('La bozza di Olga')
  await expect(saveState(page)).toContainText('Bozza salvata alle', { timeout: 10_000 })
  const olgaPost = page.url()

  const editor = await addPerson(org, 'Elia Editor', 'member', [
    { workspaceId: client.id, role: 'editor' },
  ])
  const other = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? '' })
  const elia = await other.newPage()
  await ownAddress(elia)
  await signIn(elia.request, editor)
  await elia.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  // «Salva ed esci», at the top on a computer and at the bottom on a phone: no «Salva bozza»
  await expect(elia.getByRole('button', { name: 'Salva ed esci' })).toBeVisible()
  await expect(elia.getByRole('button', { name: 'Salva bozza' })).toHaveCount(0)
  await expect(elia.locator('[data-schedule]')).toHaveCount(0)
  await expect(elia.getByRole('group', { name: 'Quando esce' })).toHaveCount(0)
  await expect(elia.getByText('La programma chi nel cliente può pubblicare.')).toBeVisible()
  expect((await axe(elia)).violations).toEqual([])

  await elia.goto(olgaPost)
  await expect(elia.getByText("È la bozza di un'altra persona")).toBeVisible()
  await expect(elia.getByRole('textbox', { name: 'Testo comune' })).toHaveAttribute('readonly', '')
  await other.close()
})

test('two tabs on the same draft: the second save is a conflict, and the text is not lost', async ({
  page,
}) => {
  const { org, client } = await clientWithFiles(page)
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Prima')
  await expect(saveState(page)).toContainText('Bozza salvata alle', { timeout: 10_000 })
  const second = await page.context().newPage()
  await second.goto(page.url())
  await second.getByRole('textbox', { name: 'Testo comune' }).fill('Dalla seconda scheda')
  await expect(saveState(second)).toContainText('Bozza salvata alle', { timeout: 10_000 })

  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Dalla prima scheda')
  await expect(saveState(page)).toContainText('Modificato da un', { timeout: 10_000 })
  await expect(page.getByRole('alert').filter({ hasText: 'ricarica per vedere' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Testo comune' })).toHaveValue(
    'Dalla prima scheda',
  )
  await page.getByRole('button', { name: 'Ricarica' }).click()
  await expect(page.getByRole('textbox', { name: 'Testo comune' })).toHaveValue(
    'Dalla seconda scheda',
  )
})

test('the network falls during the save: «Non salvata: riprova», never «Salvata»', async ({
  page,
}) => {
  const { org, client } = await clientWithFiles(page)
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await page.route('**/posts', (route) =>
    route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue(),
  )
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Senza rete')
  await expect(saveState(page)).toContainText('Non salvata: riprova', { timeout: 10_000 })
  await page.unroute('**/posts')
  await page.getByRole('button', { name: 'Riprova' }).click()
  await expect(saveState(page)).toContainText('Bozza salvata alle', { timeout: 10_000 })
})

test('a save that reached the server but lost its answer: the next one is not a conflict (D-120.1)', async ({
  page,
}) => {
  const { org, client } = await clientWithFiles(page)
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  const text = page.getByRole('textbox', { name: 'Testo comune' })
  await text.fill('Prima')
  await expect(saveState(page)).toContainText('Bozza salvata alle', { timeout: 10_000 })
  // the network falls after the server saved: the answer never comes back
  let lost = 0
  await page.route('**/posts/*', async (route) => {
    if (route.request().method() !== 'PATCH' || lost > 0) return route.continue()
    lost++
    await route.fetch()
    await route.abort('internetdisconnected')
  })
  await text.fill('Seconda, arrivata')
  await expect(saveState(page)).toContainText('Non salvata: riprova', { timeout: 10_000 })
  await text.fill('Terza, dopo la rete')
  await expect(saveState(page)).toContainText('Bozza salvata alle', { timeout: 10_000 })
  await expect(page.getByText('Modificato da un')).toHaveCount(0)
  await page.reload()
  await expect(text).toHaveValue('Terza, dopo la rete')
})

test('in the evening the post goes to tomorrow, and «Quando» says it (D-120.5)', async ({
  page,
}) => {
  const { org, client } = await clientWithFiles(page)
  // 21:30 in Rome: today's 18:00 is gone, the editor proposes tomorrow
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date())
  await page.clock.setFixedTime(new Date(`${today}T20:30:00Z`))
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  const line = page.locator('[data-when-tomorrow]')
  await expect(line).toHaveText(/Domani, \p{L}+ \d{1,2} \p{L}+( \d{4})? alle 18:00$/u)
  // a time still ahead tonight, on tomorrow, is not «because of the evening»
  await page.locator('[data-time-field]').click()
  await page.getByRole('textbox', { name: "Scrivi un'ora" }).fill('2300')
  await page.keyboard.press('Enter')
  await expect(line).toHaveCount(0)
  await page.locator('[data-time-field]').click()
  await page.getByRole('textbox', { name: "Scrivi un'ora" }).fill('0930')
  await page.keyboard.press('Enter')
  await expect(line).toContainText('alle 9:30')
  expect((await axe(page)).violations).toEqual([])
})

// P1 of the stage 6 review: «Esci lo stesso» leaves, and the post stays as it was
test('a scheduled post changed: «Esci lo stesso» leaves, and the post stays as it was', async ({
  page,
}) => {
  const { org, client } = await clientWithFiles(page)
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['pane.jpg'])
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Il pane del lunedì')
  await expect(scheduleButton(page)).toBeEnabled({ timeout: 15_000 })
  await scheduleButton(page).click()
  await page.locator('[data-toast]').getByRole('link', { name: 'Apri' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Post programmato' })).toBeVisible()
  const postUrl = page.url()

  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Una modifica da buttare')
  await page.getByRole('main').getByRole('link', { name: 'Forno Luce' }).click()
  const dialog = page.getByRole('dialog', { name: 'Uscire senza salvare?' })
  await expect(dialog).toBeVisible()
  // «Resta qui» first: the page and the change are still there
  await dialog.getByRole('button', { name: 'Resta qui' }).click()
  await expect(page.getByRole('textbox', { name: 'Testo comune' })).toHaveValue(
    'Una modifica da buttare',
  )
  await page.getByRole('main').getByRole('link', { name: 'Forno Luce' }).click()
  await dialog.getByRole('button', { name: 'Esci lo stesso' }).click()
  await expect(page).toHaveURL(new RegExp(`/spazi/${client.slug}/post$`))

  await page.goto(postUrl)
  await expect(page.getByRole('textbox', { name: 'Testo comune' })).toHaveValue(
    'Il pane del lunedì',
  )
})

test('a draft that cannot be saved (no network): «Esci lo stesso» leaves', async ({ page }) => {
  const { org, client } = await clientWithFiles(page)
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Prima della rete')
  await expect(saveState(page)).toContainText('Bozza salvata alle', { timeout: 10_000 })
  const draftUrl = page.url()
  await page.route('**/posts/*', (route) =>
    route.request().method() === 'PATCH' ? route.abort('internetdisconnected') : route.continue(),
  )
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Senza rete')
  await expect(saveState(page)).toContainText('Non salvata: riprova', { timeout: 10_000 })
  await page.getByRole('main').getByRole('link', { name: 'Forno Luce' }).click()
  await page
    .getByRole('dialog', { name: 'Uscire senza salvare?' })
    .getByRole('button', { name: 'Esci lo stesso' })
    .click()
  await expect(page).toHaveURL(new RegExp(`/spazi/${client.slug}/post$`))
  await page.unroute('**/posts/*')
  // the change left behind was not saved
  await page.goto(draftUrl)
  await expect(page.getByRole('textbox', { name: 'Testo comune' })).toHaveValue('Prima della rete')
})

test('leaving a new post while a file uploads: the page changes, the upload goes on in the corner', async ({
  page,
}) => {
  const { org, client } = await clientWithFiles(page)
  // the pieces wait: the file is still uploading when the person leaves
  await page.route('**/uploads/*/parts/*', () => undefined)
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await page
    .locator('[data-post-input]')
    .setInputFiles(new URL('./fixtures/clip.mp4', import.meta.url).pathname)
  await expect(page.getByRole('group', { name: /clip\.mp4/ })).toBeVisible()
  await page.getByRole('main').getByRole('link', { name: 'Forno Luce' }).click()
  await expect(page).toHaveURL(new RegExp(`/spazi/${client.slug}/post$`))
  await expect(page.getByTestId('uploads-dock')).toContainText('clip.mp4')
})

// P6 of the stage 6 review: a file that finishes after the editor closed goes into its draft
test.describe('a file that finishes after leaving the editor goes into the post', () => {
  const filesOf = async (where: string, value: string) =>
    adminQuery<{ post_id: string; name: string }>(
      `select pm.post_id, m.original_name as name from post_media pm
         join media m on m.organization_id = pm.organization_id and m.id = pm.media_id
        where ${where} = $1 order by pm.position`,
      [value],
    )

  async function leaveWhileUploading(page: Page, slug: string) {
    // the pieces wait at a gate until the person has left; a piece the client gave up on
    // and sent again waits there too
    let open: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (open = resolve))
    let held = 0
    await page.route('**/uploads/*/parts/*', async (route) => {
      held++
      await gate
      await route.continue().catch(() => undefined)
    })
    await page
      .locator('[data-post-input]')
      .setInputFiles(new URL('./fixtures/clip.mp4', import.meta.url).pathname)
    await expect.poll(() => held).toBeGreaterThan(0)
    await page.getByRole('main').getByRole('link', { name: 'Forno Luce' }).click()
    await expect(page).toHaveURL(new RegExp(`/spazi/${slug}/post$`))
    open()
  }

  test('into the draft it was on', async ({ page }) => {
    const { org, client } = await clientWithFiles(page)
    await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
    await pickFromLibrary(page, ['pane.jpg'])
    await expect(saveState(page)).toContainText('Bozza salvata alle', { timeout: 10_000 })
    // the address becomes the post's right after its first save
    await expect(page).toHaveURL(/\/post\/[0-9a-f-]{36}$/)
    const postId = page.url().split('/').pop() ?? ''
    await leaveWhileUploading(page, client.slug)
    await expect
      .poll(async () => (await filesOf('pm.post_id', postId)).map((f) => f.name), {
        timeout: 20_000,
      })
      .toEqual(['pane.jpg', 'clip.mp4'])
  })

  test('a new post with only that file: the draft is made with it, once', async ({ page }) => {
    const { org, client } = await clientWithFiles(page)
    await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
    await leaveWhileUploading(page, client.slug)
    await expect
      .poll(async () => (await filesOf('pm.workspace_id', client.id)).map((f) => f.name), {
        timeout: 20_000,
      })
      .toEqual(['clip.mp4'])
  })
})

test('a Viewer reads a post: no actions, no library, no thumbnails', async ({ page, browser }) => {
  const { org, client } = await clientWithFiles(page)
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['pane.jpg'])
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Da vedere soltanto')
  await expect(saveState(page)).toContainText('Bozza salvata alle', { timeout: 10_000 })
  await expect(page).not.toHaveURL(/\/post\/nuovo/)
  const address = new URL(page.url()).pathname

  const viewer = await addPerson(org, 'Vera Vista', 'member', [
    { workspaceId: client.id, role: 'viewer' },
  ])
  const other = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? '' })
  const vera = await other.newPage()
  await ownAddress(vera)
  await signIn(vera.request, viewer)
  await vera.goto(address)
  await expect(vera.getByText('Puoi vedere il post, non modificarlo.')).toBeVisible()
  await expect(vera.getByRole('textbox', { name: 'Testo comune' })).toHaveAttribute('readonly', '')
  await expect(vera.getByRole('button', { name: 'Dalla libreria' })).toHaveCount(0)
  await expect(vera.locator('[data-add-file]')).toHaveCount(0)
  await expect(vera.getByRole('button', { name: /^Salva (bozza|ed esci)$/ })).toHaveCount(0)
  await expect(vera.locator('[data-schedule]')).toHaveCount(0)
  await expect(vera.getByRole('main').locator('img')).toHaveCount(0)
  expect((await axe(vera)).violations).toEqual([])
  await other.close()
})

// the row at the top (Task R5): «Salva ed esci» saves on the way out; the row fits from 768 px
test('«Salva ed esci» saves the draft and leaves; the row at the top fits at 768 px', async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 1280) < 768, 'the row at the top is on a computer')
  const { org, client } = await clientWithFiles(page)
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['pane.jpg'])
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Prima di uscire')
  await expect(saveState(page)).toContainText('Bozza salvata alle', { timeout: 10_000 })
  await expect(page).toHaveURL(/\/post\/[0-9a-f-]{36}$/)
  const draftUrl = page.url()

  // the widest row: a draft with what is missing and both buttons, at the narrowest computer
  await page.setViewportSize({ width: 768, height: 900 })
  await expect(page.getByRole('button', { name: 'Anteprima' })).toBeVisible()
  const bar = page.locator('[data-editor-bar]')
  expect(await bar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
  await expect(scheduleButton(page)).toBeInViewport({ ratio: 1 })

  // a change typed just now goes with the person when they leave
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Salvato uscendo')
  await page.getByRole('button', { name: 'Salva ed esci' }).click()
  await expect(page).toHaveURL(new RegExp(`/spazi/${client.slug}/post$`))
  await page.goto(draftUrl)
  await expect(page.getByRole('textbox', { name: 'Testo comune' })).toHaveValue('Salvato uscendo')

  // with no network the save fails, and leaving asks first
  await page.route('**/posts/*', (route) =>
    route.request().method() === 'PATCH' ? route.abort('internetdisconnected') : route.continue(),
  )
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Senza rete')
  await page.getByRole('button', { name: 'Salva ed esci' }).click()
  await expect(page.getByRole('dialog', { name: 'Uscire senza salvare?' })).toBeVisible()
})

test('on a phone: one bar at the bottom with the state and «Programma», above the keyboard', async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 1280) >= 768, 'the bar at the bottom is on a phone')
  const { org, client } = await clientWithFiles(page)
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['pane.jpg'])
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Il pane del lunedì')
  const bar = page.locator('[data-action-bar]')
  await expect(bar.locator('[data-save-state]')).toContainText(
    /Bozza salvata\s*alle \d{1,2}:\d\d/,
    {
      timeout: 10_000,
    },
  )
  await expect(bar.locator('[data-schedule]')).toHaveText(/Programma su 2 account/)
  await expect(page.getByRole('button', { name: 'Salva bozza' })).toHaveCount(0)
  // the checks are the last row of the form
  await expect(page.locator('section#post-summary')).toBeVisible()

  // the keyboard takes the lower 340 px: the bar moves above it, never under it
  await page.getByRole('textbox', { name: 'Testo comune' }).focus()
  const height = page.viewportSize()?.height ?? 800
  await page.evaluate((covered) => {
    const v = window.visualViewport
    if (!v) return
    Object.defineProperty(v, 'height', {
      configurable: true,
      get: () => window.innerHeight - covered,
    })
    v.dispatchEvent(new Event('resize'))
  }, 340)
  await expect
    .poll(async () => {
      const box = await bar.boundingBox()
      return box ? box.y + box.height : Infinity
    })
    .toBeLessThanOrEqual(height - 340 + 1)
})

test('«Dalla libreria» with the client’s folders: the last one again, the search in it or everywhere, «Carica» into it (D-103)', async ({
  page,
}) => {
  const { owner, org, client } = await clientWithFiles(page)
  const headers = { origin: new URL(process.env.E2E_BASE_URL ?? '').origin, 'x-app-request': '1' }
  const made = await page.request.post(`/api/v1/orgs/${org}/workspaces/${client.id}/folders`, {
    headers,
    data: { name: 'Novembre', parentId: null },
  })
  const novembre = ((await made.json()) as { id: string }).id
  await libraryFile(org, client.id, owner.userId, {
    kind: 'image',
    name: 'sfoglia.jpg',
    folderId: novembre,
  })
  const phone = (page.viewportSize()?.width ?? 1280) < 768
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  const openPicker = async () => {
    if (phone) {
      await page.locator('[data-add-file]').click()
      await page.getByRole('menuitem', { name: 'Dalla libreria' }).click()
    } else await page.getByRole('button', { name: 'Dalla libreria' }).click()
    return page.getByRole('dialog', { name: 'Scegli dalla libreria' })
  }
  const files = (dialog: ReturnType<Page['getByRole']>) =>
    dialog.getByRole('list', { name: 'Scegli dalla libreria' }).getByRole('listitem')

  let dialog = await openPicker()
  await expect(files(dialog)).toHaveCount(3)
  if (phone) {
    await dialog.getByRole('combobox', { name: 'Cartella' }).click()
    await page.getByRole('option', { name: 'Novembre' }).click()
    // the path back to every file
    await expect(dialog.getByRole('navigation', { name: 'Percorso della cartella' })).toContainText(
      'Novembre',
    )
  } else await dialog.locator('[data-picker-folder="Novembre"]').click()
  await expect(files(dialog)).toHaveCount(1)
  await expect(files(dialog)).toContainText('sfoglia.jpg')
  expect((await axe(page)).violations).toEqual([])
  await dialog.getByRole('button', { name: 'Annulla' }).click()
  await expect(dialog).toHaveCount(0)

  // opened again on the same folder; the search looks in it, or in the whole client
  dialog = await openPicker()
  await expect(files(dialog)).toHaveCount(1)
  await dialog.getByRole('searchbox', { name: 'Cerca in «Novembre»' }).fill('pane')
  await expect(dialog.getByText('Nessun file da aggiungere.')).toBeVisible()
  await dialog.getByRole('checkbox', { name: 'In tutto Forno Luce' }).click()
  await expect(files(dialog)).toHaveCount(1)
  await expect(files(dialog)).toContainText('pane.jpg')
  await dialog.getByRole('checkbox', { name: 'In tutto Forno Luce' }).click()
  await dialog.getByRole('searchbox', { name: 'Cerca in «Novembre»' }).fill('')

  // «Carica»: from the computer into «Novembre», and into the post
  await dialog
    .locator('[data-picker-input]')
    .setInputFiles(new URL('./fixtures/frame.jpg', import.meta.url).pathname)
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[data-entry]')).toHaveCount(1)
  await expect
    .poll(
      async () =>
        (
          await adminQuery<{ folder_id: string | null }>(
            "select folder_id from upload_sessions where workspace_id = $1 and original_name = 'frame.jpg'",
            [client.id],
          )
        )[0]?.folder_id ?? null,
      { timeout: 15_000 },
    )
    .toBe(novembre)
})

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
  await page.getByRole('button', { name: 'Dalla libreria' }).click()
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
  await page.getByRole('main').getByRole('link', { name: 'Nuovo post' }).click()
  await expect(page).toHaveURL(/\/post\/nuovo$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Nuovo post' })).toBeVisible()
  // no file: the four types, none chosen; nothing saved yet
  await expect(page.locator('[data-type][aria-pressed="true"]')).toHaveCount(0)
  await expect(saveState(page)).toContainText('si salva da sola')
  expect((await axe(page)).violations).toEqual([])

  await pickFromLibrary(page, ['pane.jpg', 'focaccia.jpg'])
  // two files: Carosello by itself, Foto and Reel off with their reason
  await expect(page.locator('[data-type="carousel"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-type="photo"]')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByText('Foto vuole un file solo.')).toBeVisible()
  // the draft is born with its first content, and the address becomes the post's
  await expect(saveState(page)).toContainText('Bozza salvata alle', { timeout: 10_000 })
  await expect(page).toHaveURL(/\/post\/[0-9a-f-]{36}$/)

  // the order with the keyboard: the first file goes after the second
  await page.locator('[data-entry]').first().focus()
  await page.getByRole('button', { name: 'Sposta dopo pane.jpg' }).click()
  await expect(page.locator('[data-entry]').first()).toHaveAccessibleName(/File 1: focaccia\.jpg/)

  // a text of its own for Instagram
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Il pane di segale è tornato')
  await page.getByRole('switch', { name: 'Testo diverso per piattaforma' }).click()
  await page.getByRole('tab', { name: 'Instagram' }).click()
  await page
    .getByRole('textbox', { name: 'Testo per Instagram' })
    .fill('Il pane di segale è tornato #panedisegale')
  await expect(page.locator('[data-counters]').first()).toContainText('1 di 30 hashtag')

  // the Page off: only Instagram
  await page.locator(`[data-account="${fb}"]`).click()
  await expect(page.getByText('Un account scelto')).toBeVisible()
  await expect(saveState(page)).toContainText('Bozza salvata alle', { timeout: 10_000 })
  // let the last change reach the server before the reload
  await expect(saveState(page)).not.toContainText('Salvataggio')

  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Bozza' })).toBeVisible()
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

test('schedule, back to draft, cancel: the actions of a Publisher and up', async ({ page }) => {
  const { org, client } = await clientWithFiles(page)
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await pickFromLibrary(page, ['pane.jpg'])
  await expect(page.locator('[data-type="photo"]')).toHaveAttribute('aria-pressed', 'true')
  // the date proposed is ahead, the zone said next to it
  await expect(page.locator('[data-when-sentence]')).toContainText('ora di Roma')
  await expect(scheduleButton(page)).toBeEnabled({ timeout: 15_000 })
  await expect(scheduleButton(page)).toHaveText(/Programma su 2 account/)
  await scheduleButton(page).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Post programmato' })).toBeVisible()
  await expect(page.getByText('Nella 0.12 non esce ancora')).toBeVisible()

  await page.getByRole('button', { name: 'Riporta in bozza' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Bozza' })).toBeVisible()
  await scheduleButton(page).click()
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
  await expect(elia.getByRole('button', { name: 'Salva bozza' })).toBeVisible()
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

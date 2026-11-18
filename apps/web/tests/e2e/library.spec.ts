import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { seed } from '@app/infrastructure/testing'
import { libraryFile } from './support/media.ts'
import { addPerson, newPerson, ownAddress, signIn } from './support/people.ts'

// The library (plan 04 Task 12, spec §11.8): «Libreria» in the sidebar from Editor up, the files of
// the chosen client with folders and tags, move with «Sposta in…» and by dragging, the video
// player on the preview, «Elimina». A Viewer finds no page. On a phone it opens from the client.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768
const grid = (page: Page) => page.getByRole('list', { name: 'Libreria' })
const tile = (page: Page, name: string) =>
  grid(page).getByRole('listitem').filter({ hasText: name })

async function fitsTheScreen(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

/** An Editor of Forno Luce, with two photos and a video in its library. */
async function editorWithLibrary(page: Page) {
  const owner = await newPerson('Olga Libreria', 'owner')
  const org = owner.organizationSlug
  const client = await seed(process.env.E2E_DATABASE_URL ?? '', (s) =>
    s.workspace(org, { name: 'Forno Luce' }),
  )
  const editor = await addPerson(org, 'Elia Editor', 'member', [
    { workspaceId: client, role: 'editor' },
  ])
  await libraryFile(org, client, editor.userId, {
    kind: 'image',
    name: 'pane-01.jpg',
    tags: ['natale'],
  })
  await libraryFile(org, client, editor.userId, {
    kind: 'image',
    name: 'cornetti.jpg',
    tags: ['colazione'],
  })
  await libraryFile(org, client, editor.userId, {
    kind: 'video',
    name: 'laboratorio.mov',
    tags: ['natale'],
  })
  await signIn(page.request, editor)
  return { org, client, editor }
}

test('from «Libreria», the client chosen, the library filters by tag, type and name', async ({
  page,
}) => {
  test.skip(isPhone(page), 'on a phone the library opens from the client')
  const { org } = await editorWithLibrary(page)
  await page.goto(`/${org}`)
  await page
    .getByRole('navigation', { name: 'Navigazione principale' })
    .getByRole('link', { name: 'Libreria' })
    .click()
  await expect(page).toHaveURL(new RegExp(`/${org}/libreria`))
  await expect(page.getByRole('heading', { level: 1, name: 'Libreria' })).toBeVisible()
  // no client chosen: the page asks for one
  await page
    .getByRole('list', { name: 'Scegli un cliente' })
    .getByRole('link', { name: 'Forno Luce' })
    .click()
  await expect(page).toHaveURL(/spazio=/)
  await expect(grid(page).getByRole('listitem')).toHaveCount(3)
  await expect(page.getByText(/Forno Luce · Spazio occupato/)).toBeVisible()

  await page.getByRole('combobox', { name: 'Tag' }).click()
  await page.getByRole('option', { name: '#natale' }).click()
  await expect(grid(page).getByRole('listitem')).toHaveCount(2)
  await expect(tile(page, 'cornetti.jpg')).toHaveCount(0)

  await page
    .getByRole('group', { name: 'Tipo di file' })
    .getByRole('button', { name: 'Video' })
    .click()
  await expect(grid(page).getByRole('listitem')).toHaveCount(1)
  await expect(tile(page, 'laboratorio.mov')).toContainText('Video 0:18')

  await page
    .getByRole('group', { name: 'Tipo di file' })
    .getByRole('button', { name: 'Tutti' })
    .click()
  await page.getByRole('searchbox', { name: 'Cerca per nome' }).fill('pane')
  await expect(grid(page).getByRole('listitem')).toHaveCount(1)
  await expect(tile(page, 'pane-01.jpg')).toBeVisible()

  const results = await axe(page)
  expect(results.violations).toEqual([])
})

test('a file moves into a folder with «Sposta in…» and by dragging', async ({ page }) => {
  test.skip(isPhone(page), 'dragging is for a computer; the phone has «Sposta in…»')
  const { org, client } = await editorWithLibrary(page)
  await page.goto(`/${org}/libreria?spazio=${client}`)
  await expect(grid(page).getByRole('listitem')).toHaveCount(3)
  const folders = page.getByRole('navigation', { name: 'Cartelle' })

  await folders.getByRole('button', { name: 'Nuova cartella' }).click()
  await page.getByRole('textbox', { name: 'Nome della cartella' }).fill('Natale 2026')
  await page.getByRole('button', { name: 'Crea' }).click()
  await expect(page.getByText('Cartella «Natale 2026» creata.')).toBeVisible()

  // with the button
  await tile(page, 'pane-01.jpg').getByRole('button', { name: 'Azioni per pane-01.jpg' }).click()
  await page.getByRole('menuitem', { name: 'Sposta in…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sposta «pane-01.jpg»' })
  await dialog.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Natale 2026' }).click()
  await dialog.getByRole('button', { name: 'Sposta' }).click()
  await expect(page.getByText('«pane-01.jpg» spostato in «Natale 2026».')).toBeVisible()

  // by dragging onto the folder
  await tile(page, 'cornetti.jpg').dragTo(folders.getByRole('button', { name: /Natale 2026/ }))
  await expect(page.getByText('«cornetti.jpg» spostato in «Natale 2026».')).toBeVisible()

  await folders.getByRole('button', { name: /Natale 2026/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Natale 2026' })).toBeVisible()
  await expect(grid(page).getByRole('listitem')).toHaveCount(2)
  await expect(folders.getByRole('button', { name: /Natale 2026/ })).toContainText('2')

  // a folder with files is deleted only with a confirmation, and its files go with it
  await page.getByRole('button', { name: 'Azioni per Natale 2026' }).click()
  await page.getByRole('menuitem', { name: 'Elimina cartella' }).click()
  const confirm = page.getByRole('dialog', { name: 'Eliminare «Natale 2026»?' })
  await expect(confirm).toContainText('Contiene 2 file.')
  await expect(confirm).toContainText('eliminati definitivamente')
  await confirm.getByRole('button', { name: 'Elimina tutto' }).click()
  await expect(page.getByText('Cartella eliminata.')).toBeVisible()
  await expect(grid(page).getByRole('listitem')).toHaveCount(1)
  await expect(tile(page, 'pane-01.jpg')).toHaveCount(0)
})

test('the detail plays the video, saves the tags and deletes the file', async ({ page }) => {
  const { org, client } = await editorWithLibrary(page)
  // on a phone too: the client's tab
  await page.goto(`/${org}/spazi/${client}`)
  await page
    .getByRole('navigation', { name: 'Sezioni del cliente' })
    .getByRole('link', { name: 'Libreria' })
    .click()
  await expect(page).toHaveURL(new RegExp(`/spazi/${client}/libreria$`))
  await expect(grid(page).getByRole('listitem')).toHaveCount(3)
  await fitsTheScreen(page)

  await tile(page, 'laboratorio.mov')
    .getByRole('button', { name: /laboratorio\.mov/ })
    .first()
    .click()
  const detail = page.getByRole('dialog', { name: 'laboratorio.mov' })
  await expect(detail.getByText('Preparato per partire subito in riproduzione')).toBeVisible()
  await expect(detail.getByText('1080 × 1920 px')).toBeVisible()
  // the player reads the preview by ranges, and plays it
  const player = detail.getByTestId('media-player')
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(2)
  await player.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true
    await v.play()
  })
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0)

  const tags = detail.getByRole('textbox', { name: 'Tag' })
  await tags.fill('Forno')
  await tags.press('Enter')
  await expect(page.getByText('Tag salvati.')).toBeVisible()

  const results = await axe(page)
  expect(results.violations).toEqual([])

  await detail.getByRole('button', { name: 'Elimina' }).click()
  const confirm = page.getByRole('dialog', { name: 'Eliminare «laboratorio.mov»?' })
  await confirm.getByRole('button', { name: 'Elimina' }).click()
  await expect(page.getByText('«laboratorio.mov» eliminato.')).toBeVisible()
  await expect(grid(page).getByRole('listitem')).toHaveCount(2)
  // the confirmation goes away by itself after a few seconds (prova 0.10.0, E-3)
  await expect(page.getByText('«laboratorio.mov» eliminato.')).toBeHidden({ timeout: 8_000 })
})

test('the library shows a grid with thumbnails of the chosen size, or a list, and remembers it', async ({
  page,
}) => {
  const { org, client, editor } = await editorWithLibrary(page)
  await libraryFile(org, client, editor.userId, { kind: 'image', name: 'IMG_0221.HEIC' })
  await libraryFile(org, client, editor.userId, { kind: 'image', name: 'IMG_0222.HEIC' })
  await libraryFile(org, client, editor.userId, {
    kind: 'video',
    name: 'IMG_0233.mov',
    status: 'failed',
  })
  await page.goto(`/${org}/spazi/${client}/libreria`)
  await expect(grid(page).getByRole('listitem')).toHaveCount(6)
  await fitsTheScreen(page)
  // two names alike are not cut to the same «IMG_022…»
  for (const name of ['IMG_0221.HEIC', 'IMG_0222.HEIC']) {
    const button = tile(page, name)
      .getByRole('button', { name: new RegExp(name) })
      .first()
    expect(await button.evaluate((b) => b.scrollHeight <= b.clientHeight)).toBe(true)
  }
  // the failed file says so in red
  await expect(tile(page, 'IMG_0233.mov')).toContainText('Non riuscito')

  const view = page.getByRole('group', { name: 'Vista' })
  const columns = () =>
    grid(page).evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length)
  const before = await columns()
  const size = page.getByRole('slider', { name: 'Dimensione delle miniature' })
  await expect(size).toHaveAttribute('aria-valuetext', 'Medie')
  if (isPhone(page)) {
    // a target of 44 px on a phone
    const box = await page.locator('[data-thumb-size] [data-slot="root"]').boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }
  await size.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(size).toHaveAttribute('aria-valuetext', 'Molto grandi')
  await expect.poll(columns).toBeLessThan(before)

  await view.getByRole('button', { name: 'Elenco' }).click()
  await expect(view.getByRole('button', { name: 'Elenco' })).toHaveAttribute('aria-pressed', 'true')
  await expect(size).toHaveCount(0)
  await expect(grid(page)).toHaveAttribute('data-layout', 'list')
  // the list gives the whole name, the weight and the day
  await expect(tile(page, 'IMG_0221.HEIC')).toContainText('IMG_0221.HEIC')
  await expect(tile(page, 'IMG_0221.HEIC')).toContainText(/MB · \d+ \w+ \d{4}/)
  await fitsTheScreen(page)
  const results = await axe(page)
  expect(results.violations).toEqual([])

  // the choice stays in this browser
  await page.reload()
  await expect(grid(page)).toHaveAttribute('data-layout', 'list')
  await view.getByRole('button', { name: 'Griglia' }).click()
  await expect(page.getByRole('slider', { name: 'Dimensione delle miniature' })).toHaveAttribute(
    'aria-valuetext',
    'Molto grandi',
  )
})

test('a long name stays on two lines, then the dots, and is whole on hover and to a screen reader', async ({
  page,
}) => {
  const { org, client, editor } = await editorWithLibrary(page)
  const long = 'cornetti-colazione-domenica-con-cappuccino-e-brioche-calde-appena-sfornate.jpg'
  await libraryFile(org, client, editor.userId, { kind: 'image', name: long })
  await page.goto(`/${org}/spazi/${client}/libreria`)
  const view = page.getByRole('group', { name: 'Vista' })
  for (const layout of ['Griglia', 'Elenco']) {
    await view.getByRole('button', { name: layout }).click()
    const button = tile(page, long)
      .getByRole('button', { name: new RegExp(long) })
      .first()
    await expect(button).toHaveAttribute('title', long)
    const lines = await button.evaluate((b) => {
      const style = getComputedStyle(b)
      return {
        clamp: style.webkitLineClamp,
        rows: Math.round(b.clientHeight / parseFloat(style.lineHeight)),
        cut: b.scrollHeight > b.clientHeight,
      }
    })
    expect(lines.clamp).toBe('2')
    expect(lines.rows).toBeLessThanOrEqual(2)
    // in the grid the name is longer than two lines: the rest is cut, not drawn
    if (layout === 'Griglia') expect(lines).toEqual({ clamp: '2', rows: 2, cut: true })
  }
})

test('a video that ran out of time says what to do, and «Riprova» prepares it again', async ({
  page,
}) => {
  const { org, client, editor } = await editorWithLibrary(page)
  await libraryFile(org, client, editor.userId, {
    kind: 'video',
    name: 'IMG_0233.mov',
    status: 'failed',
    failure: 'timeout',
  })
  await page.goto(`/${org}/spazi/${client}/libreria`)
  await tile(page, 'IMG_0233.mov')
    .getByRole('button', { name: /IMG_0233\.mov/ })
    .first()
    .click()
  const detail = page.getByRole('dialog', { name: 'IMG_0233.mov' })
  await expect(detail.getByText(/esportalo in 1080p o a 30 fps/)).toBeVisible()
  await expect(detail.getByText(/cancella da solo dopo 24 ore/)).toBeVisible()
  await detail.getByRole('button', { name: 'Riprova' }).click()
  await expect(page.getByText('«IMG_0233.mov» si prepara di nuovo.')).toBeVisible()
  await expect(detail.getByRole('button', { name: 'Riprova' })).toHaveCount(0)
  await expect(detail.getByText('Anteprima in preparazione')).toBeVisible()
})

test('a Viewer sees no «Libreria» and the address gives «Pagina non trovata»', async ({ page }) => {
  const owner = await newPerson('Olga Viewer', 'owner')
  const org = owner.organizationSlug
  const client = await seed(process.env.E2E_DATABASE_URL ?? '', (s) =>
    s.workspace(org, { name: 'Orto Vivo' }),
  )
  const viewer = await addPerson(org, 'Vera Viewer', 'member', [
    { workspaceId: client, role: 'viewer' },
  ])
  await signIn(page.request, viewer)
  await page.goto(`/${org}/spazi/${client}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Orto Vivo' })).toBeVisible()
  await expect(
    page.getByRole('navigation', { name: 'Sezioni del cliente' }).getByText('Libreria'),
  ).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Libreria' })).toHaveCount(0)
  await page.goto(`/${org}/libreria`)
  await expect(page.getByRole('heading', { name: 'Pagina non trovata' })).toBeVisible()
})

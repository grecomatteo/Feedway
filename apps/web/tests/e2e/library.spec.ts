import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { seed } from '@app/infrastructure/testing'
import { libraryFile } from './support/media.ts'
import { addPerson, adminQuery, newPerson, ownAddress, signIn } from './support/people.ts'

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

test('«Libreria» shows the files of the clients by day, filtered by type, use and name or tag', async ({
  page,
}) => {
  const { org, client } = await editorWithLibrary(page)
  const [file] = await adminQuery<{ id: string }>(
    "select id from media where workspace_id = $1 and original_name = 'cornetti.jpg'",
    [client],
  )
  await postWith(page, org, client, [file?.id ?? ''], 'draft')
  await page.goto(`/${org}`)
  if (isPhone(page)) await page.goto(`/${org}/libreria`)
  else
    await page
      .getByRole('navigation', { name: 'Navigazione principale' })
      .getByRole('link', { name: 'Libreria' })
      .click()
  await expect(page).toHaveURL(new RegExp(`/${org}/libreria`))
  await expect(page.getByRole('heading', { level: 1, name: 'Libreria' })).toBeVisible()
  const today = page.getByRole('list', { name: 'Oggi' })
  await expect(today.getByRole('listitem')).toHaveCount(3)
  const kinds = page.getByRole('group', { name: 'Tipo di file' })
  await expect(kinds.getByRole('button', { name: /Tutti/ })).toContainText('3')
  await expect(kinds.getByRole('button', { name: /Video/ })).toContainText('1')
  await expect(today.getByRole('listitem').filter({ hasText: 'cornetti.jpg' })).toContainText(
    'In una bozza',
  )
  if (!isPhone(page))
    await expect(today.getByRole('listitem').filter({ hasText: 'pane-01.jpg' })).toContainText(
      'Forno Luce',
    )
  await fitsTheScreen(page)

  await kinds.getByRole('button', { name: /Video/ }).click()
  await expect(today.getByRole('listitem')).toHaveCount(1)
  await expect(today.getByRole('listitem')).toContainText('0:18')
  await kinds.getByRole('button', { name: /Tutti/ }).click()

  // the search finds a tag too
  await page.getByRole('searchbox', { name: 'Cerca per nome o tag' }).fill('natale')
  await expect(today.getByRole('listitem')).toHaveCount(2)
  await page.getByRole('searchbox', { name: 'Cerca per nome o tag' }).fill('')
  await expect(today.getByRole('listitem')).toHaveCount(3)

  if (!isPhone(page)) {
    await page.getByRole('combobox', { name: 'Nei post' }).click()
    await page.getByRole('option', { name: 'Solo in bozze' }).click()
    await expect(today.getByRole('listitem')).toHaveCount(1)
    await expect(today.getByRole('listitem')).toContainText('cornetti.jpg')
    await page.getByRole('combobox', { name: 'Nei post' }).click()
    await page.getByRole('option', { name: 'Nei post: tutti' }).click()
    await expect(today.getByRole('listitem')).toHaveCount(3)

    // the detail open: the files make room beside it, none under it (screen 20, B7)
    await today
      .getByRole('listitem')
      .first()
      .getByRole('button', { name: /\.(jpg|mov)/ })
      .first()
      .click()
    const detail = page.getByRole('dialog')
    await expect(detail).toBeVisible()
    const panel = await detail.boundingBox()
    for (const item of await today.getByRole('listitem').all()) {
      const box = await item.boundingBox()
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(panel?.x ?? 0)
    }
    await page.keyboard.press('Escape')
    await expect(detail).toHaveCount(0)
  }

  const results = await axe(page)
  expect(results.violations).toEqual([])
})

test('a file moves into a folder with «Sposta in…» and by dragging', async ({ page }) => {
  test.skip(isPhone(page), 'dragging is for a computer; the phone has «Sposta in…»')
  const { org, client } = await editorWithLibrary(page)
  await page.goto(`/${org}/spazi/${client}/libreria`)
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
  await tile(page, 'cornetti.jpg').dragTo(folders.locator('[data-folder="Natale 2026"]'))
  await expect(page.getByText('«cornetti.jpg» spostato in «Natale 2026».')).toBeVisible()

  await folders.locator('[data-folder="Natale 2026"]').click()
  await expect(page.getByRole('heading', { level: 2, name: 'Natale 2026' })).toBeVisible()
  await expect(grid(page).getByRole('listitem')).toHaveCount(2)
  await expect(folders.locator('[data-folder="Natale 2026"]')).toContainText('2')

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

test('every folder has its «⋯»: new folder inside, rename, move and delete (D-103)', async ({
  page,
}) => {
  const { org, client } = await editorWithLibrary(page)
  await page.goto(`/${org}/spazi/${client}/libreria`)
  await expect(grid(page).getByRole('listitem')).toHaveCount(3)
  const create = async (name: string) => {
    // «Nuova cartella» with its text, in the column or, on a phone, next to the menu
    await page
      .getByRole('button', { name: 'Nuova cartella', exact: true })
      .locator('visible=true')
      .click()
    await page.getByRole('textbox', { name: 'Nome della cartella' }).fill(name)
    await page.getByRole('button', { name: 'Crea' }).click()
    await expect(page.getByText(`Cartella «${name}» creata.`)).toBeVisible()
  }
  await create('Novembre')
  await create('Reel')

  /** The «⋯» of a folder: in the column on a computer, next to its name once open on a phone. */
  const actions = async (name: string) => {
    if (isPhone(page)) {
      await page.getByRole('combobox', { name: 'Cartella' }).click()
      await page.getByRole('option', { name: new RegExp(`${name}$`) }).click()
      await page.getByRole('button', { name: `Azioni per ${name}` }).click()
    } else {
      const column = page.getByRole('navigation', { name: 'Cartelle' })
      await column.locator(`[data-folder="${name}"]`).hover()
      await column.getByRole('button', { name: `Azioni per la cartella ${name}` }).click()
    }
  }

  await actions('Reel')
  await page.getByRole('menuitem', { name: 'Rinomina' }).click()
  await page.getByRole('textbox', { name: 'Nome della cartella' }).fill('Reel di novembre')
  await page.getByRole('button', { name: 'Salva' }).click()
  await expect(page.getByText('Cartella rinominata.')).toBeVisible()

  await actions('Reel di novembre')
  await page.getByRole('menuitem', { name: 'Sposta…' }).click()
  const move = page.getByRole('dialog', { name: 'Sposta la cartella «Reel di novembre»' })
  await move.getByRole('combobox').click()
  // never into itself
  await expect(page.getByRole('option', { name: 'Reel di novembre' })).toHaveCount(0)
  await page.getByRole('option', { name: 'Novembre' }).click()
  await move.getByRole('button', { name: 'Sposta' }).click()
  await expect(move).toHaveCount(0)
  await expect(page.getByText('Cartella «Reel di novembre» spostata in «Novembre».')).toBeVisible()
  if (!isPhone(page))
    await expect(
      page
        .getByRole('navigation', { name: 'Cartelle' })
        .locator('[data-folder="Reel di novembre"]'),
    ).toHaveAttribute('style', /padding-left: 1\.5rem/)

  const results = await axe(page)
  expect(results.violations).toEqual([])

  await actions('Novembre')
  await page.getByRole('menuitem', { name: 'Elimina cartella' }).click()
  const confirm = page.getByRole('dialog', { name: 'Eliminare «Novembre»?' })
  await expect(confirm).toContainText('1 sottocartella')
  await confirm.getByRole('button', { name: 'Elimina tutto' }).click()
  await expect(page.getByText('Cartella eliminata.')).toBeVisible()
  await fitsTheScreen(page)
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
  await expect(detail.getByText('1080 × 1920 · 0:18 · 18,4 MB')).toBeVisible()
  await detail.getByText('Dettagli tecnici').click()
  await expect(detail.getByText('Preparato per partire subito in riproduzione')).toBeVisible()
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

  // the tags as chips, «+ Tag» opens a small field (screen 20)
  const chips = detail.getByRole('list', { name: 'Tag' })
  await expect(chips.getByRole('listitem')).toHaveText(['natale'])
  await detail.getByRole('button', { name: 'Aggiungi un tag' }).click()
  const tag = detail.getByRole('textbox', { name: 'Nuovo tag' })
  await tag.fill('Forno')
  await tag.press('Enter')
  await expect(page.getByText('Tag salvati.')).toBeVisible()
  await expect(chips.getByRole('listitem')).toHaveText(['natale', 'forno'])
  await expect(tag).toHaveCount(0)
  await expect(detail.getByRole('button', { name: 'Aggiungi un tag' })).toBeFocused()
  // «×» shows on hover (and always on a touch screen)
  await chips.getByRole('listitem').filter({ hasText: 'natale' }).hover()
  await detail.getByRole('button', { name: 'Togli il tag «natale»' }).click()
  await expect(chips.getByRole('listitem')).toHaveText(['forno'])
  // the focus stays on the tags: the next «×», then «+ Tag»
  await expect(detail.getByRole('button', { name: 'Togli il tag «forno»' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(chips).toHaveCount(0)
  await expect(detail.getByRole('button', { name: 'Aggiungi un tag' })).toBeFocused()

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
  await expect(tile(page, 'IMG_0221.HEIC')).toContainText(/MB · oggi/)
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

test('a long name: one line with the dots in the grid, two in the list, whole on hover', async ({
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
    const shape = await button.evaluate((b) => {
      const style = getComputedStyle(b)
      return {
        clamp: style.webkitLineClamp,
        ellipsis: style.textOverflow === 'ellipsis',
        rows: Math.round(b.clientHeight / parseFloat(style.lineHeight)),
        cut: b.scrollHeight > b.clientHeight || b.scrollWidth > b.clientWidth,
      }
    })
    // screen 19: one line in the grid; the list keeps two (D-63)
    if (layout === 'Griglia') expect(shape).toMatchObject({ ellipsis: true, rows: 1, cut: true })
    else {
      expect(shape.clamp).toBe('2')
      expect(shape.rows).toBeLessThanOrEqual(2)
    }
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

/** A post of the client with these files, written by the Editor and then put in a state. */
async function postWith(
  page: Page,
  org: string,
  client: string,
  mediaIds: string[],
  status: 'draft' | 'scheduled' | 'cancelled',
) {
  const res = await page.request.post(`/api/v1/orgs/${org}/workspaces/${client}/posts`, {
    headers: { origin: new URL(process.env.E2E_BASE_URL ?? '').origin, 'x-app-request': '1' },
    data: { type: 'photo', mediaIds, caption: { common: `Pane ${status}` } },
  })
  expect(res.status()).toBeLessThan(300)
  const { id } = (await res.json()) as { id: string }
  if (status !== 'draft') await setStatus(id, status)
  return id
}
/** A post scheduled, or cancelled, from elsewhere: on 10 June 2027 at 18:00 in Rome. */
const setStatus = (postId: string, status: 'scheduled' | 'cancelled') =>
  adminQuery(
    `update posts set status = $2, scheduled_at = '2027-06-10T16:00:00Z', updated_at = now(),
            scheduled_by = case when $2 = 'scheduled' then created_by end
      where id = $1`,
    [postId, status],
  )

test('the post a file is in is said the same way with every filter (D-80.7)', async ({ page }) => {
  const { org, client } = await editorWithLibrary(page)
  const [file] = await adminQuery<{ id: string }>(
    "select id from media where workspace_id = $1 and original_name = 'pane-01.jpg'",
    [client],
  )
  const id = file?.id ?? ''
  await postWith(page, org, client, [id], 'cancelled')
  await postWith(page, org, client, [id], 'scheduled')
  await postWith(page, org, client, [id], 'draft')
  await page.goto(`/${org}/spazi/${client}/libreria`)
  const label = /Nel post di gio 10 giu 2027, 18:00/
  await expect(tile(page, 'pane-01.jpg')).toContainText(label)

  await page.getByRole('button', { name: 'Nei post' }).click()
  await expect(grid(page).getByRole('listitem')).toHaveCount(1)
  await expect(tile(page, 'pane-01.jpg')).toContainText(label)

  await page.getByRole('button', { name: 'Nei post' }).click()
  await page.getByRole('searchbox', { name: 'Cerca per nome' }).fill('pane')
  await expect(grid(page).getByRole('listitem')).toHaveCount(1)
  await expect(tile(page, 'pane-01.jpg')).toContainText(label)
})

test('the file of a scheduled post says it is not deleted, without asking first (D-80.4)', async ({
  page,
}) => {
  const { org, client } = await editorWithLibrary(page)
  const [file] = await adminQuery<{ id: string }>(
    "select id from media where workspace_id = $1 and original_name = 'cornetti.jpg'",
    [client],
  )
  await postWith(page, org, client, [file?.id ?? ''], 'scheduled')
  await page.goto(`/${org}/spazi/${client}/libreria`)
  const reason = 'Non si può eliminare: è in un post programmato per gio 10 giu 2027 alle 18:00.'

  // «⋯»: the item is off, with the reason (a phone has no «⋯»: the detail has every action)
  if (!isPhone(page)) {
    await tile(page, 'cornetti.jpg')
      .getByRole('button', { name: 'Azioni per cornetti.jpg' })
      .click()
    const item = page.getByRole('menuitem', { name: /Elimina/ })
    await expect(item).toBeDisabled()
    await expect(item).toContainText(reason)
    await page.keyboard.press('Escape')
  }

  // the detail: off, the reason and the way to the post
  await tile(page, 'cornetti.jpg')
    .getByRole('button', { name: /cornetti\.jpg/ })
    .first()
    .click()
  const detail = page.getByRole('dialog', { name: 'cornetti.jpg' })
  // screen 20: no «Elimina», the reason in its place
  await expect(detail.getByRole('button', { name: 'Elimina' })).toHaveCount(0)
  await expect(detail.getByText(reason)).toBeVisible()
  await expect(
    detail.getByRole('link', { name: 'Toglilo dal post o annulla il post per eliminarlo.' }),
  ).toHaveAttribute('href', new RegExp(`/spazi/${client}/post/`))
  await expect(page.getByRole('dialog', { name: /Eliminare/ })).toHaveCount(0)
  const results = await axe(page)
  expect(results.violations).toEqual([])
})

test('a post scheduled after the page was read: the refusal says why, and the file follows', async ({
  page,
}) => {
  const { org, client } = await editorWithLibrary(page)
  const [file] = await adminQuery<{ id: string }>(
    "select id from media where workspace_id = $1 and original_name = 'cornetti.jpg'",
    [client],
  )
  const post = await postWith(page, org, client, [file?.id ?? ''], 'draft')
  await page.goto(`/${org}/spazi/${client}/libreria`)
  await expect(tile(page, 'cornetti.jpg')).toContainText('In una bozza')

  await tile(page, 'cornetti.jpg')
    .getByRole('button', { name: /cornetti\.jpg/ })
    .first()
    .click()
  const detail = page.getByRole('dialog', { name: 'cornetti.jpg' })
  await setStatus(post, 'scheduled')
  await detail.getByRole('button', { name: 'Elimina' }).click()
  await page
    .getByRole('dialog', { name: 'Eliminare «cornetti.jpg»?' })
    .getByRole('button', { name: 'Elimina' })
    .click()
  const reason = 'Non si può eliminare: è in un post programmato per gio 10 giu 2027 alle 18:00.'
  await expect(page.getByText(reason).first()).toBeVisible()
  // the detail read again: the reason in place of «Elimina»
  await expect(detail.getByRole('button', { name: 'Elimina' })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: /Eliminare/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(detail).toHaveCount(0)
  await expect(page.getByRole('alert').filter({ hasText: reason })).toBeVisible()
  await expect(tile(page, 'cornetti.jpg')).toContainText('Nel post di gio 10 giu 2027, 18:00')
  await expect(grid(page).getByRole('listitem')).toHaveCount(3)
})

test('one library: the clients with their folders, a client and its folder in the address (D-103)', async ({
  page,
}) => {
  // a Publisher of two clients out of three: the third never shows
  const owner = await newPerson('Olga Unita', 'owner')
  const org = owner.organizationSlug
  const url = process.env.E2E_DATABASE_URL ?? ''
  const forno = await seed(url, (s) => s.workspace(org, { name: 'Forno Luce' }))
  const osteria = await seed(url, (s) => s.workspace(org, { name: 'Osteria Bruna' }))
  await seed(url, (s) => s.workspace(org, { name: 'Gelateria Polo' }))
  const publisher = await addPerson(org, 'Pia Publisher', 'member', [
    { workspaceId: forno, role: 'publisher' },
    { workspaceId: osteria, role: 'publisher' },
  ])
  await signIn(page.request, publisher)
  const headers = { origin: new URL(process.env.E2E_BASE_URL ?? '').origin, 'x-app-request': '1' }
  const folder = async (name: string, parentId: string | null) => {
    const res = await page.request.post(`/api/v1/orgs/${org}/workspaces/${forno}/folders`, {
      headers,
      data: { name, parentId },
    })
    expect(res.status()).toBeLessThan(300)
    return ((await res.json()) as { id: string }).id
  }
  const novembre = await folder('Novembre', null)
  const reel = await folder('Reel', novembre)
  await libraryFile(org, forno, publisher.userId, {
    kind: 'video',
    name: 'sfoglia.mov',
    folderId: reel,
  })
  await libraryFile(org, forno, publisher.userId, { kind: 'image', name: 'pane.jpg' })
  await libraryFile(org, osteria, publisher.userId, { kind: 'image', name: 'sala.jpg' })

  await page.goto(`/${org}/libreria`)
  await expect(page.getByRole('list', { name: 'Oggi' }).getByRole('listitem')).toHaveCount(3)
  if (!isPhone(page)) {
    const tree = page.getByRole('navigation', { name: 'Clienti e cartelle' })
    await expect
      .poll(() =>
        tree
          .locator('[data-tree-client]')
          .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-tree-client'))),
      )
      .toEqual(['Forno Luce', 'Osteria Bruna'])
    await tree.getByRole('button', { name: 'Cartelle di Forno Luce' }).click()
    const branch = tree.getByRole('list', { name: 'Cartelle di Forno Luce' })
    await expect(branch.locator('[data-tree-folder]')).toHaveText([/Novembre/, /Reel/])
    await branch.locator('[data-tree-folder="Reel"]').click()
  } else {
    // on a phone the client from the filter, then the folder from the menu
    await page.getByRole('combobox', { name: 'Cliente' }).click()
    await expect(page.getByRole('option')).toHaveText([
      'Tutti i clienti',
      'Forno Luce',
      'Osteria Bruna',
    ])
    await page.getByRole('option', { name: 'Forno Luce' }).click()
    await page.getByRole('combobox', { name: 'Cartella' }).click()
    await page.getByRole('option', { name: /Reel$/ }).click()
  }
  // the client and the folder are in the address (the seed gives a client its id as slug), and
  // the context selector agrees
  await expect(page).toHaveURL((u) => {
    const q = new URL(u).searchParams
    return q.get('spazio') === forno && q.get('cartella') === reel
  })

  await expect(page.getByRole('heading', { level: 2, name: 'Reel' })).toBeVisible()
  await expect(grid(page).getByRole('listitem')).toHaveCount(1)
  await expect(tile(page, 'sfoglia.mov')).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^Contesto: Forno Luce/ }).locator('visible=true'),
  ).toBeVisible()
  await fitsTheScreen(page)
  const results = await axe(page)
  expect(results.violations).toEqual([])

  // the address opens it again; the client's tab is the same library
  await page.reload()
  await expect(page.getByRole('heading', { level: 2, name: 'Reel' })).toBeVisible()
  await page.goto(`/${org}/spazi/${forno}/libreria?cartella=${reel}`)
  await expect(page.getByRole('heading', { level: 2, name: 'Reel' })).toBeVisible()
  await expect(grid(page).getByRole('listitem')).toHaveCount(1)

  // back to every client from the filter
  await page.goto(`/${org}/libreria?spazio=${forno}`)
  await expect(grid(page).getByRole('listitem')).toHaveCount(2)
  if (isPhone(page)) {
    await page.getByRole('combobox', { name: 'Cliente' }).click()
    await page.getByRole('option', { name: 'Tutti i clienti' }).click()
  } else await page.getByRole('link', { name: 'Tutti i clienti' }).click()
  await expect(page).toHaveURL(new RegExp(`/${org}/libreria$`))
  await expect(page.getByRole('list', { name: 'Oggi' }).getByRole('listitem')).toHaveCount(3)
})

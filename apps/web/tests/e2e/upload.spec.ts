import { mkdtemp, open, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { seed } from '@app/infrastructure/testing'
import { runMediaProcessJobs } from './support/jobs.ts'
import { addPerson, newPerson, ownAddress, signIn } from './support/people.ts'

// Uploading from the panel (plan 04 Task 13, spec §11.1, §14.2): «Carica file», drop and paste,
// pieces with their sha-256 counted in a Web Worker, a bar per file, pause, resume and cancel,
// resume on its own after a fall, the uploads left halfway by a reload, and «Pronto» once the
// worker has prepared the file.

test.use({ baseURL: process.env.E2E_BASE_URL })

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname
const PARTS = '**/uploads/*/parts/*'

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
  // every CSP refusal of the page, the Web Worker's included
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { cspViolations: string[] }).cspViolations = seen
    document.addEventListener('securitypolicyviolation', (e) => {
      seen.push(`${e.violatedDirective} ${e.blockedURI}`)
    })
  })
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
const row = (page: Page, name: string) => page.locator(`[data-upload="${name}"]`)
const announcer = (page: Page) => page.locator('[data-upload-announcer]')
const input = (page: Page) => page.locator('[data-upload-input]')
const cspViolations = (page: Page) =>
  page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations)

/** An Editor of Forno Luce, on the client's «Libreria» tab (the way in from a phone too). */
async function editorOnLibrary(page: Page) {
  const owner = await newPerson('Olga Caricamenti', 'owner')
  const org = owner.organizationSlug
  const client = await seed(process.env.E2E_DATABASE_URL ?? '', (s) =>
    s.workspace(org, { name: 'Forno Luce' }),
  )
  const editor = await addPerson(org, 'Elia Editor', 'member', [
    { workspaceId: client, role: 'editor' },
  ])
  await signIn(page.request, editor)
  await page.goto(`/${org}/spazi/${client}/libreria`)
  await expect(page.locator('[data-ready]')).toBeVisible()
  return { org, client }
}

/** Holds the pieces until `release`: the upload stays halfway as long as the test needs. */
async function holdPieces(page: Page) {
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => (release = resolve))
  const held: Route[] = []
  await page.route(PARTS, async (route) => {
    held.push(route)
    await gate
    await route.continue().catch(() => undefined)
  })
  return {
    held,
    release: async () => {
      await page.unroute(PARTS)
      release()
    },
  }
}

async function untilReady(page: Page, names: string[]) {
  for (const name of names)
    await expect(row(page, name)).toHaveAttribute('data-state', 'processing', { timeout: 20_000 })
  await runMediaProcessJobs()
  for (const name of names)
    await expect(row(page, name)).toHaveAttribute('data-state', 'ready', { timeout: 20_000 })
}

test('a photo and a video go from «Carica file» to «Pronto», counted in the Web Worker', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await editorOnLibrary(page)
  await input(page).setInputFiles([fixture('frame.jpg'), fixture('clip.mp4')])
  await expect(announcer(page)).toContainText(/Caricamento di 2 file iniziato|caricato/)
  await expect(page.getByRole('progressbar', { name: 'Avanzamento di tutti i file' })).toBeVisible()
  // the video plays from the computer before it is sent (media-src blob:)
  await expect(row(page, 'clip.mp4').locator('video[data-local-preview]')).toHaveAttribute(
    'src',
    /^blob:/,
  )
  await untilReady(page, ['frame.jpg', 'clip.mp4'])
  await expect(row(page, 'frame.jpg')).toContainText('Pronto')
  await expect(announcer(page)).toContainText(/pronto|Caricamenti finiti/)
  // the library shows them, and nothing was refused by the CSP
  const grid = page.getByRole('list', { name: 'Libreria' })
  await expect(grid.getByRole('listitem')).toHaveCount(2)
  expect(await cspViolations(page)).toEqual([])
  await expect(page.locator('[data-hasher]')).toHaveAttribute('data-hasher', 'worker')
  expect((await axe(page)).violations).toEqual([])
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('a fall of the network halfway: the upload waits, then goes on by itself', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await editorOnLibrary(page)
  let falls = 0
  await page.route(PARTS, async (route) => {
    if (falls++ === 0) return route.abort('internetdisconnected')
    await route.continue()
  })
  await input(page).setInputFiles(fixture('frame.jpg'))
  await expect(row(page, 'frame.jpg')).toContainText('Connessione interrotta')
  await expect(row(page, 'frame.jpg')).toHaveAttribute('data-state', 'processing', {
    timeout: 20_000,
  })
  expect(falls).toBe(2)
})

/** The pieces: the first is held with no answer for ever, the others go through. */
async function hangFirstPiece(page: Page) {
  const seen = { pieces: 0 }
  await page.route(PARTS, async (route) => {
    if (seen.pieces++ === 0) return
    await route.continue()
  })
  return seen
}

test('a piece that hangs with no error is given up, and the upload goes on by itself', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.clock.install()
  await editorOnLibrary(page)
  const seen = await hangFirstPiece(page)
  await input(page).setInputFiles(fixture('frame.jpg'))
  await expect.poll(() => seen.pieces).toBe(1)
  await expect(row(page, 'frame.jpg')).toHaveAttribute('data-state', 'uploading')
  // 30 seconds without a byte (D-41): the piece is given up and the upload resumes
  await page.clock.fastForward('00:31')
  await expect(row(page, 'frame.jpg')).toHaveAttribute('data-state', 'offline')
  await page.clock.fastForward('00:05')
  await expect(row(page, 'frame.jpg')).toHaveAttribute('data-state', 'processing', {
    timeout: 20_000,
  })
  expect(seen.pieces).toBe(2)
})

test('the network comes back: a piece that hangs on the old one starts again at once', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await editorOnLibrary(page)
  const seen = await hangFirstPiece(page)
  await input(page).setInputFiles(fixture('frame.jpg'))
  await expect.poll(() => seen.pieces).toBe(1)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(row(page, 'frame.jpg')).toHaveAttribute('data-state', 'processing', {
    timeout: 20_000,
  })
  expect(seen.pieces).toBe(2)
})

test('a conflict that is no wait (the client archived meanwhile) stops «complete» at once', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await editorOnLibrary(page)
  let calls = 0
  await page.route('**/uploads/*/complete', async (route) => {
    calls += 1
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'CONFLICT',
          message: 'Il cliente è archiviato: i suoi file non si modificano',
          requestId: 'x',
        },
      }),
    })
  })
  await input(page).setInputFiles(fixture('frame.jpg'))
  await expect(row(page, 'frame.jpg')).toHaveAttribute('data-state', 'error', { timeout: 10_000 })
  await expect(row(page, 'frame.jpg')).toContainText('archiviato')
  expect(calls).toBe(1)
})

test('without a secure page (no HTTPS) the files are refused with the reason', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'subtle', { get: () => undefined })
  })
  await editorOnLibrary(page)
  await input(page).setInputFiles(fixture('frame.jpg'))
  await expect(row(page, 'frame.jpg')).toHaveAttribute('data-state', 'rejected')
  await expect(row(page, 'frame.jpg')).toContainText('connessione sicura')
})

test('pause, resume and cancel, all from the keyboard', async ({ page }) => {
  test.setTimeout(90_000)
  await editorOnLibrary(page)
  const pieces = await holdPieces(page)
  // «Carica file» opens the file chooser from the keyboard
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Carica file' }).focus()
  await page.keyboard.press('Enter')
  await (await chooser).setFiles([fixture('frame.jpg'), fixture('clip.mp4')])
  await expect.poll(() => pieces.held.length).toBe(2)

  await page.getByRole('button', { name: 'Metti in pausa frame.jpg' }).focus()
  await page.keyboard.press('Enter')
  await expect(row(page, 'frame.jpg')).toHaveAttribute('data-state', 'paused')
  await expect(row(page, 'frame.jpg')).toContainText('In pausa')
  await expect(announcer(page)).toContainText('frame.jpg in pausa')

  const cancelled = page.waitForRequest(
    (r) => r.method() === 'DELETE' && /\/uploads\/[^/]+$/.test(r.url()),
  )
  await page.getByRole('button', { name: 'Annulla il caricamento di clip.mp4' }).focus()
  await page.keyboard.press('Enter')
  await cancelled
  await expect(row(page, 'clip.mp4')).toHaveCount(0)
  await expect(announcer(page)).toContainText('Caricamento di clip.mp4 annullato')

  await pieces.release()
  await page.getByRole('button', { name: 'Riprendi frame.jpg' }).focus()
  await page.keyboard.press('Enter')
  await expect(row(page, 'frame.jpg')).toHaveAttribute('data-state', 'processing', {
    timeout: 20_000,
  })
})

test('after a reload the upload left halfway resumes with the same file chosen again', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await editorOnLibrary(page)
  // the piece never arrives: the upload stays open with nothing received
  await page.route(PARTS, (route) => route.abort('internetdisconnected'))
  const started = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/uploads$/.test(r.url()),
  )
  await input(page).setInputFiles(fixture('clip.mp4'))
  await started
  await expect(row(page, 'clip.mp4')).toHaveAttribute('data-state', 'offline')
  await page.unroute(PARTS)
  await page.reload()

  const left = page.getByRole('region', { name: 'Caricamenti rimasti a metà' })
  await expect(left).toContainText('clip.mp4')
  // another file is not taken for it
  let chooser = page.waitForEvent('filechooser')
  await left.getByRole('button', { name: 'Scegli di nuovo il file clip.mp4' }).click()
  await (await chooser).setFiles(fixture('frame.jpg'))
  await expect(row(page, 'clip.mp4')).toContainText('Non è il file rimasto a metà')
  await row(page, 'clip.mp4')
    .getByRole('button', { name: 'Annulla il caricamento di clip.mp4' })
    .click()
  await expect(row(page, 'clip.mp4')).toHaveCount(0)

  chooser = page.waitForEvent('filechooser')
  await left.getByRole('button', { name: 'Scegli di nuovo il file clip.mp4' }).click()
  await (await chooser).setFiles(fixture('clip.mp4'))
  await expect(row(page, 'clip.mp4')).toHaveAttribute('data-state', 'processing', {
    timeout: 20_000,
  })
  await expect(left).toHaveCount(0)
})

test('a picture pasted with Ctrl+V and files dropped on the library upload too', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await editorOnLibrary(page)
  const jpeg = (await readFile(fixture('frame.jpg'))).toString('base64')
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], 'image.png', { type: 'image/jpeg' }))
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }))
  }, jpeg)
  await expect(page.locator('[data-upload^="Incollata "]')).toHaveCount(1)
  await expect(page.locator('[data-upload^="Incollata "]')).toHaveAttribute(
    'data-state',
    'processing',
    { timeout: 20_000 },
  )

  // a drop: «Rilascia qui» while the files are over the library
  const drop = await page.evaluateHandle((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], 'trascinata.jpg', { type: 'image/jpeg' }))
    return data
  }, jpeg)
  const library = page.locator('[data-ready]')
  await library.dispatchEvent('dragenter', { dataTransfer: drop })
  await expect(page.locator('[data-drop-zone]')).toContainText('Rilascia qui')
  await library.dispatchEvent('drop', { dataTransfer: drop })
  await expect(page.locator('[data-drop-zone]')).toHaveCount(0)
  await expect(row(page, 'trascinata.jpg')).toHaveAttribute('data-state', 'processing', {
    timeout: 20_000,
  })
})

test('a file too large or of another type is refused at once, the others go on', async ({
  page,
}) => {
  await editorOnLibrary(page)
  // a photo of 60 MB, over the 50 MB of photos, without writing it: a sparse file
  const dir = await mkdtemp(join(tmpdir(), 'upload-'))
  const big = join(dir, 'enorme.jpg')
  const handle = await open(big, 'w')
  await handle.truncate(60_000_000)
  await handle.close()
  const gif = join(dir, 'animazione.gif')
  await writeFile(gif, 'GIF89a')
  await input(page).setInputFiles([big, gif, fixture('frame.jpg')])
  await expect(row(page, 'enorme.jpg')).toHaveAttribute('data-state', 'rejected')
  await expect(row(page, 'enorme.jpg')).toContainText('pesa 60 MB, le foto al massimo 50 MB')
  await expect(row(page, 'animazione.gif')).toContainText('si caricano solo foto')
  // the refusals are read together with the start, not covered by it
  await expect(announcer(page)).toContainText('animazione.gif')
  await expect(announcer(page)).toContainText('Caricamento di un file iniziato')
  await expect(row(page, 'frame.jpg')).toHaveAttribute('data-state', 'processing', {
    timeout: 20_000,
  })
  expect((await axe(page)).violations).toEqual([])
})

test('the same file uploaded again is taken, and its row says it is already there', async ({
  page,
}) => {
  await editorOnLibrary(page)
  await input(page).setInputFiles(fixture('frame.jpg'))
  await expect(row(page, 'frame.jpg')).toHaveAttribute('data-state', 'processing', {
    timeout: 20_000,
  })
  await input(page).setInputFiles({
    name: 'frame copia.jpg',
    mimeType: 'image/jpeg',
    buffer: await readFile(fixture('frame.jpg')),
  })
  await expect(row(page, 'frame copia.jpg')).toHaveAttribute('data-state', 'processing', {
    timeout: 20_000,
  })
  await expect(row(page, 'frame copia.jpg').locator('[data-upload-duplicate]')).toHaveText(
    'Uguale a «frame.jpg», già nella libreria. Se non ti serve, eliminalo.',
  )
  await expect(row(page, 'frame.jpg').locator('[data-upload-duplicate]')).toHaveCount(0)
})

test('an upload goes on while the person moves around the panel, in the corner (D-21)', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await editorOnLibrary(page)
  const gate = await holdPieces(page)
  await input(page).setInputFiles(fixture('frame.jpg'))
  await expect.poll(() => gate.held.length).toBeGreaterThan(0)
  const dock = page.getByTestId('uploads-dock')
  // the library draws its uploads itself: nothing in the corner
  await expect(dock).toHaveCount(0)

  await page.getByRole('link', { name: 'Panoramica' }).click()
  await expect(page).not.toHaveURL(/libreria/)
  await expect(dock).toBeVisible()
  await expect(dock).toContainText('Caricamento di un file')
  await expect(dock).toContainText('frame.jpg')
  expect((await axe(page)).violations).toEqual([])

  await gate.release()
  await expect(dock).toContainText(/In preparazione|Analisi|Conversione/, { timeout: 20_000 })
  await runMediaProcessJobs()
  await expect(dock).toContainText('Pronto', { timeout: 20_000 })
  await expect(dock).toContainText('Un file caricato')

  // back in the library the file is there, and the corner is empty again
  await dock.getByRole('link', { name: 'Apri la libreria' }).click()
  await expect(page.getByRole('list', { name: 'Libreria' }).getByRole('listitem')).toHaveCount(1)
  await expect(dock).toHaveCount(0)
})

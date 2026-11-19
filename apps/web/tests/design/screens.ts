import type { Page } from '@playwright/test'
import type { DesignSample } from '../e2e/support/design-sample.ts'
import { libraryFile } from '../e2e/support/media.ts'
import { adminQuery } from '../e2e/support/people.ts'

/**
 * The screens of the references (design/esplorazioni/2026-11-19-nuova-direzione/schermate) that the
 * code already draws, with the page and the state each one shows. Every task of the redesign adds
 * its screens here (plan, «Come si prova la fedeltà»).
 */
export interface Screen {
  /** the reference's file name without `.png`, the same in `computer/` and `telefono/` */
  id: string
  path: (s: DesignSample) => string
  /** what to do once the page is ready: open a menu, fill a field… */
  prepare?: (page: Page, s: DesignSample) => Promise<void>
  /** only on a computer (00-sistema has no phone version) */
  computerOnly?: boolean
}

/** Opens a menu of the shell: the client selector or the person's menu, on either size. */
async function openShell(page: Page, which: 'selector' | 'person') {
  const phone = (page.viewportSize()?.width ?? 1440) < 768
  const trigger =
    which === 'selector'
      ? page.getByRole('button', { name: /^Contesto:/ }).locator('visible=true')
      : phone
        ? page.getByRole('button', { name: /^Tu, menu di/ })
        : page.getByRole('button', { name: /Giulia Ferri/ }).locator('visible=true')
  await trigger.click()
  await page
    .getByRole(which === 'selector' ? 'listbox' : 'menu')
    .locator('visible=true')
    .first()
    .waitFor()
  // the pointer leaves the menu, so no row shows its hover, and the opening animation ends
  await page.mouse.move(0, 0)
  await page.waitForTimeout(300)
}

/** A new post of Forno Luce, as the editor shows it with these files from the library and text. */
async function newPost(page: Page, files: string[], caption: string) {
  // on a phone the library is in the menu of «Aggiungi»
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.locator('[data-add-file]').click()
    await page.getByRole('menuitem', { name: 'Dalla libreria' }).click()
  } else await page.getByRole('button', { name: 'Dalla libreria' }).click()
  const dialog = page.getByRole('dialog', { name: 'Scegli dalla libreria' })
  for (const name of files) await dialog.getByRole('button', { name }).click()
  await dialog.getByRole('button', { name: /^Aggiungi/ }).click()
  await dialog.waitFor({ state: 'detached' })
  await page.getByRole('textbox', { name: 'Testo comune' }).fill(caption)
  await page.locator('[data-save-state]').getByText('Bozza salvata alle').waitFor()
  await page.waitForLoadState('networkidle')
  await page.locator('h1').click()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(300)
}
/** The accounts chosen in «Dove», by their name; then back to the top of the page. */
async function tick(page: Page, names: RegExp[]) {
  for (const name of names) {
    const box = page.getByRole('checkbox', { name })
    if ((await box.getAttribute('aria-checked')) !== 'true') await box.click()
  }
  await page.locator('[data-save-state]').getByText('Bozza salvata alle').waitFor()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => {
    window.scrollTo(0, 0)
  })
}
const forno = (s: DesignSample) => s.clients['Forno Luce'] ?? { id: '', slug: '' }

export const SCREENS: Screen[] = [
  { id: '00-sistema', path: () => '/__test/sistema', computerOnly: true },
  // the shell (Task R2): the pages inside it are redrawn by their own tasks
  { id: '02-oggi', path: (s) => `/${s.org}` },
  // the same morning with nothing to fix: the issues' read answers empty, the sample stays as it is
  {
    id: '03-oggi-niente-da-sistemare',
    path: (s) => `/${s.org}`,
    prepare: async (page) => {
      await page.route(/\/agenda\/issues\?/, (route) => route.fulfill({ json: { items: [] } }))
      await page.reload()
      await page.locator('[data-today-calm]').waitFor()
      await page.waitForLoadState('networkidle')
      await page.unrouteAll()
    },
  },
  {
    id: '04-selettore-del-cliente',
    path: (s) => `/${s.org}`,
    prepare: (p) => openShell(p, 'selector'),
  },
  { id: '06-menu-utente', path: (s) => `/${s.org}`, prepare: (p) => openShell(p, 'person') },
  { id: '14-clienti', path: (s) => `/${s.org}/spazi` },
  // «Nuovo cliente» with the name typed and the two profiles in no client ticked
  {
    id: '15-nuovo-cliente',
    path: (s) => `/${s.org}/spazi`,
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Nuovo cliente' }).locator('visible=true').click()
      const dialog = page.getByRole('dialog', { name: 'Nuovo cliente' })
      await dialog.getByRole('checkbox', { name: '@barcentrale.bo' }).click()
      await dialog.getByRole('checkbox', { name: 'Bar Centrale Bologna' }).click()
      await dialog.getByRole('textbox', { name: 'Nome' }).fill('Bar Centrale')
      await dialog.getByRole('textbox', { name: 'Nome' }).blur()
      await page.mouse.move(0, 0)
      await page.waitForTimeout(300)
    },
  },
  // the editor (Task R5): the top part, the form's rows; the right column and «Dove», «Quando»
  // are redrawn by Task R7
  {
    id: '08-editor-carosello',
    path: (s) => `/${s.org}/spazi/${forno(s).slug}/post/nuovo`,
    prepare: async (page) => {
      await newPost(
        page,
        ['pane.jpg', 'banco.jpg'],
        'Il pane del lunedì è appena uscito dal forno.\nVi aspettiamo in via Roma 12, dalle 7.',
      )
      await tick(page, [/^@fornoluce ·/, /^Forno Luce ·/])
      await page.mouse.move(0, 0)
      await page.waitForTimeout(300)
    },
  },
  {
    // a landscape video for a reel: one choice to make, «Programma» off
    id: '09-editor-reel-con-scelta',
    path: (s) => `/${s.org}/spazi/${forno(s).slug}/post/nuovo`,
    prepare: async (page, s) => {
      // one video for both sizes: the sample is the same
      const name = 'sfoglia-dietro-il-banco.mov'
      const known = await adminQuery<{ id: string }>(
        'select id from media where workspace_id = $1 and original_name = $2',
        [forno(s).id, name],
      )
      const id =
        known[0]?.id ??
        (await libraryFile(s.org, forno(s).id, s.owner.userId, { kind: 'video', name }))
      const analysis = {
        kind: 'video',
        format: 'mp4',
        sizeBytes: 38_800_000,
        width: 1920,
        height: 1080,
        durationMs: 42_000,
        fps: 30,
        videoCodec: 'h264',
        audioCodec: 'aac',
        faststart: true,
        hasMetadata: false,
      }
      await adminQuery(
        'update media set width = 1920, height = 1080, duration_ms = 42000, analysis = $2 where id = $1',
        [id, JSON.stringify(analysis)],
      )
      await page.reload()
      await newPost(
        page,
        ['sfoglia-dietro-il-banco.mov'],
        'Dietro il banco: come nasce la sfoglia.\nOgni mattina, dalle 5.',
      )
      // only Instagram, as in the reference
      await tick(page, [/^@fornoluce ·/])
      await page.locator('[data-missing]').locator('visible=true').waitFor()
      await page.mouse.move(0, 0)
      await page.waitForTimeout(300)
    },
  },
  // the client's page (Task R4): Forno Luce, whose third profile asks to be reconnected
  {
    id: '16-cliente-panoramica',
    path: (s) => `/${s.org}/spazi/${s.clients['Forno Luce']?.slug ?? ''}`,
  },
  {
    id: '17-cliente-post',
    path: (s) => `/${s.org}/spazi/${s.clients['Forno Luce']?.slug ?? ''}/post`,
  },
  {
    id: '18-cliente-contenuti',
    path: (s) => `/${s.org}/spazi/${s.clients['Forno Luce']?.slug ?? ''}/contenuti`,
  },
]

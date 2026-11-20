import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import type { DesignSample } from '../e2e/support/design-sample.ts'
import { libraryFile } from '../e2e/support/media.ts'
import { adminQuery } from '../e2e/support/people.ts'
import { storedZip } from '../e2e/support/zip.ts'

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
  /** only on a phone (10-editor-anteprima has no computer version) */
  phoneOnly?: boolean
  /** shot without the sample's session (01-accedi) */
  signedOut?: boolean
}

/** Opens a menu of the shell: the client selector or the person's menu, on either size. */
async function openShell(page: Page, which: 'selector' | 'person') {
  const phone = (page.viewportSize()?.width ?? 1440) < 768
  const trigger =
    which === 'selector'
      ? page.getByRole('button', { name: /^Contesto:/ }).locator('visible=true')
      : phone
        ? page.getByRole('button', { name: /^Tu, menu di/ })
        : page
            .getByRole('button', { name: /Giulia/, expanded: false })
            .locator('visible=true')
            .first()
  // fail in seconds, not at the end of the whole run, when the trigger is not found
  await trigger.click({ timeout: 15_000 })
  await page
    .getByRole(which === 'selector' ? 'listbox' : 'menu')
    .locator('visible=true')
    .first()
    .waitFor()
  // the pointer leaves the menu, so no row shows its hover, and the opening animation ends
  await page.mouse.move(0, 0)
  await page.waitForTimeout(300)
}

/** The names libraryLikeTheScreen gives the files of Forno Luce (screen 19). */
const RENAMED: Record<string, string> = {
  'pane.jpg': 'pane-lunedi-01.jpg',
  'banco.jpg': 'banco-brioche.jpg',
  'impasto.jpg': 'impasto-mani.jpg',
}

/** A new post of Forno Luce, as the editor shows it with these files from the library and text. */
async function newPost(page: Page, files: string[], caption: string) {
  // on a phone the library is in the menu of «Aggiungi»
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.locator('[data-add-file]').click()
    await page.getByRole('menuitem', { name: 'Dalla libreria' }).click()
  } else await page.getByRole('button', { name: 'Dalla libreria' }).click()
  const dialog = page.getByRole('dialog', { name: 'Scegli dalla libreria' })
  // 19-libreria renames the files on the computer pass, before the phone takes this screen
  for (const name of files)
    await dialog
      .getByRole('button', { name: new RegExp(`^(${name}|${RENAMED[name] ?? name})$`) })
      .click()
  await dialog.getByRole('button', { name: /^Aggiungi/ }).click()
  await dialog.waitFor({ state: 'detached' })
  await page.getByRole('textbox', { name: 'Testo comune' }).fill(caption)
  // on a phone the state is in the bar at the bottom, «Bozza salvata» over «alle 11:53»
  await page
    .locator('[data-save-state]')
    .filter({ hasText: /Bozza salvata\s*alle/ })
    .first()
    .waitFor({ state: 'attached' })
  await page.waitForLoadState('networkidle')
  await page.locator('h1').click()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(300)
}
/** «Quando» on another day of the month shown, by its number, from the panel's own day field. */
async function pickDay(page: Page, day: number) {
  await page.locator('[data-day-field]').click()
  await page
    .locator('[data-day-picker]')
    .getByRole('button', { name: new RegExp(` ${String(day)} `) })
    .first()
    .click()
  // on a phone the state is in the bar at the bottom, «Bozza salvata» over «alle 11:53»
  await page
    .locator('[data-save-state]')
    .filter({ hasText: /Bozza salvata\s*alle/ })
    .first()
    .waitFor({ state: 'attached' })
}
/** The accounts chosen in «Dove», by their name; then back to the top of the page. */
async function tick(page: Page, names: RegExp[]) {
  for (const name of names) {
    const box = page.getByRole('checkbox', { name })
    if ((await box.getAttribute('aria-checked')) !== 'true') await box.click()
  }
  // on a phone the state is in the bar at the bottom, «Bozza salvata» over «alle 11:53»
  await page
    .locator('[data-save-state]')
    .filter({ hasText: /Bozza salvata\s*alle/ })
    .first()
    .waitFor({ state: 'attached' })
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => {
    window.scrollTo(0, 0)
  })
}

/**
 * The folders of Forno Luce for the screen of the client's library (Task 10 of stage 7): «Novembre»
 * with «Reel» and «Copertine» inside, and «Archivio»; once only, the phone finds them made.
 */
async function folders(page: Page, s: DesignSample) {
  const client = s.clients['Forno Luce']?.id ?? ''
  const base = `/api/v1/orgs/${s.org}/workspaces/${client}/folders`
  const headers = { origin: new URL(page.url()).origin, 'x-app-request': '1' }
  const list = (await (await page.request.get(base, { headers })).json()) as {
    items: { id: string; name: string }[]
  }
  const make = async (name: string, parentId: string | null) => {
    const found = list.items.find((f) => f.name === name)
    if (found) return found.id
    const res = await page.request.post(base, { headers, data: { name, parentId } })
    return ((await res.json()) as { id: string }).id
  }
  const novembre = await make('Novembre', null)
  await make('Reel', novembre)
  await make('Copertine', novembre)
  await make('Archivio', null)
  await page.reload()
  await page.waitForLoadState('networkidle')
  await page.mouse.move(0, 0)
}

const asset = (name: string) =>
  readFile(new URL(`../../../../design/feedway-ui-assets/${name}`, import.meta.url))
const ASSETS = {
  pane: 'adbaa4719c5d6833.jpg',
  banco: '85eaab7ce7e4bb91.jpg',
  impasto: '47a5e2c5a89af42c.jpg',
} as const

/**
 * The library of screen 19: the sample's files with the names of the screen, and the files no post
 * uses, uploaded today and earlier in the week (the clock of the shots is Thursday 19/11, 10:00).
 */
async function libraryLikeTheScreen(page: Page, s: DesignSample) {
  const id = (name: string) => s.clients[name]?.id ?? ''
  const rename = async (client: string, from: string, to: string, at: string, size: number) =>
    adminQuery(
      `update media set original_name = $3, created_at = $4, size_bytes = $5
        where workspace_id = $1 and original_name = $2`,
      [id(client), from, to, at, size],
    )
  await rename('Forno Luce', 'pane.jpg', 'pane-lunedi-01.jpg', '2026-11-19T08:50:00Z', 2_400_000)
  await adminQuery(
    `update library_items set tags = '{pane,lunedi}' where media_id =
      (select id from media where workspace_id = $1 and original_name = $2)`,
    [id('Forno Luce'), 'pane-lunedi-01.jpg'],
  )
  await rename('Forno Luce', 'impasto.jpg', 'impasto-mani.jpg', '2026-11-19T08:10:00Z', 1_800_000)
  await rename('Forno Luce', 'banco.jpg', 'banco-brioche.jpg', '2026-11-19T08:20:00Z', 3_000_000)
  await rename(
    'Gelateria Polo',
    'banco.jpg',
    'gusti-autunno.heic',
    '2026-11-19T08:30:00Z',
    1_200_000,
  )
  await rename('Osteria Bruna', 'banco.jpg', 'sala-venerdi.jpg', '2026-11-17T15:00:00Z', 2_700_000)
  await rename(
    'Ottica Venti',
    'impasto.jpg',
    'cucina-preparazione.jpg',
    '2026-11-17T09:00:00Z',
    1_400_000,
  )
  const add = async (
    client: string,
    name: string,
    photo: keyof typeof ASSETS,
    at: string,
    size: number,
    video?: { durationMs: number },
  ) => {
    // idempotent: the sample is shared by the screens and their two sizes
    const [had] = await adminQuery<{ id: string }>(
      'select id from media where workspace_id = $1 and original_name = $2',
      [id(client), name],
    )
    if (had) return had.id
    const file = await libraryFile(s.org, id(client), s.owner.userId, {
      kind: video ? 'video' : 'image',
      name,
      image: await asset(ASSETS[photo]),
    })
    await adminQuery(
      `update media set created_at = $2, size_bytes = $3, width = $4, height = $5,
              duration_ms = $6 where id = $1`,
      [file, at, size, video ? 1920 : 1080, video ? 1080 : 1350, video?.durationMs ?? null],
    )
    return file
  }
  await add('Forno Luce', 'pane-lunedi-02.jpg', 'pane', '2026-11-19T08:55:00Z', 2_100_000)
  await add(
    'Forno Luce',
    'sfoglia-dietro-il-banco.mov',
    'impasto',
    '2026-11-19T09:14:00Z',
    38_800_000,
    {
      durationMs: 42_000,
    },
  )
  await add('Forno Luce', 'segale-mercoledi.jpg', 'pane', '2026-11-18T07:00:00Z', 2_200_000)
  await add('Gelateria Polo', 'insegna-gelato.jpg', 'banco', '2026-11-16T10:00:00Z', 1_100_000)
  await add('Forno Luce', 'pagnotta-tagliata.jpg', 'pane', '2026-11-16T09:00:00Z', 2_000_000)
  await add('Osteria Bruna', 'bancone-dettaglio.jpg', 'banco', '2026-11-16T08:00:00Z', 1_600_000)
  await page.reload()
  await page.locator('[data-ready]').first().waitFor()
  await page.waitForLoadState('networkidle')
}

const forno = (s: DesignSample) => s.clients['Forno Luce'] ?? { id: '', slug: '' }

export const SCREENS: Screen[] = [
  { id: '00-sistema', path: () => '/__test/sistema', computerOnly: true },
  // the sign-in (Task R8), with the email and a password typed as in the reference
  {
    id: '01-accedi',
    path: () => '/accedi',
    signedOut: true,
    prepare: async (page) => {
      await page.getByLabel('Email').fill('giulia@studioriva.example')
      await page.getByLabel('Password', { exact: true }).fill('una-password!')
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      })
      await page.mouse.move(0, 0)
    },
  },
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
  // the editor (Tasks R5 and R7): the day is Friday 20 as in 08, so the post is not in the past
  {
    id: '08-editor-carosello',
    path: (s) => `/${s.org}/spazi/${forno(s).slug}/post/nuovo`,
    prepare: async (page) => {
      await newPost(
        page,
        ['pane.jpg', 'banco.jpg'],
        'Il pane del lunedì è appena uscito dal forno.\nVi aspettiamo in via Roma 12, dalle 7.',
      )
      await page.getByRole('button', { name: 'Etichetta', exact: true }).click()
      // with the keyboard: under the stopped clock a click on a menu's checkbox does not tick it
      for (const name of ['Prodotto', 'Natale'])
        await page.getByRole('menuitemcheckbox', { name }).press('Enter')
      await page.keyboard.press('Escape')
      await page.locator('[data-label-chip]').nth(1).waitFor({ timeout: 10_000 })
      await pickDay(page, 20)
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
      await pickDay(page, 20)
      // only Instagram, as in the reference
      await tick(page, [/^@fornoluce ·/])
      await page.locator('[data-missing]').locator('visible=true').waitFor()
      await page.mouse.move(0, 0)
      await page.waitForTimeout(300)
    },
  },
  {
    // the preview full screen on a phone, from «Anteprima» at the top of the editor
    id: '10-editor-anteprima',
    phoneOnly: true,
    path: (s) => `/${s.org}/spazi/${forno(s).slug}/post/nuovo`,
    prepare: async (page) => {
      await newPost(
        page,
        ['pane.jpg', 'banco.jpg'],
        'Il pane del lunedì è appena uscito dal forno.\nVi aspettiamo in via Roma 12, dalle 7.',
      )
      await pickDay(page, 20)
      await tick(page, [/^@fornoluce ·/, /^Forno Luce ·/])
      await page.getByRole('button', { name: 'Anteprima' }).click()
      await page.locator('[data-preview-bar]').waitFor()
      await page.waitForLoadState('networkidle')
      await page.mouse.move(0, 0)
      await page.waitForTimeout(300)
    },
  },
  {
    // after «Programma»: back to the client's posts, with the confirmation and «Apri»
    id: '12-dopo-programma',
    path: (s) => `/${s.org}/spazi/${forno(s).slug}/post/nuovo`,
    prepare: async (page) => {
      await newPost(page, ['pane.jpg'], 'Il pane del lunedì è appena uscito dal forno.')
      await pickDay(page, 20)
      await page.locator('[data-time-field]').click()
      await page.getByRole('textbox', { name: "Scrivi un'ora" }).fill('800')
      await page.keyboard.press('Enter')
      await tick(page, [/^@fornoluce ·/, /^Forno Luce ·/])
      const schedule = page.locator('[data-schedule]').locator('visible=true')
      await schedule.waitFor()
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll<HTMLButtonElement>('[data-schedule]')].some(
            (b) => b.offsetParent !== null && !b.disabled,
          ),
        undefined,
        { timeout: 15_000 },
      )
      await schedule.click()
      const toast = page.locator('[data-toast]')
      await toast.waitFor()
      await page.waitForLoadState('networkidle')
      // the pointer on the confirmation keeps it there (it goes away by itself after 5 s)
      await toast.locator('span').first().hover()
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
  // the library (Task R6): every client, then a file's detail
  { id: '19-libreria', path: (s) => `/${s.org}/libreria`, prepare: libraryLikeTheScreen },
  {
    id: '20-libreria-file',
    path: (s) => `/${s.org}/libreria`,
    prepare: async (page, s) => {
      await libraryLikeTheScreen(page, s)
      await page
        .getByRole('button', { name: /pane-lunedi-01\.jpg/ })
        .first()
        .click()
      await page.getByRole('dialog', { name: 'pane-lunedi-01.jpg' }).waitFor()
      await page.waitForTimeout(400)
    },
  },
  // the folders of a client's library (Task 10 of stage 7), no reference: before and after
  {
    id: '27-libreria-cartelle',
    path: (s) => `/${s.org}/spazi/${s.clients['Forno Luce']?.slug ?? ''}/libreria`,
    prepare: folders,
  },
  {
    id: '28-libreria-cartella-azioni',
    path: (s) => `/${s.org}/spazi/${s.clients['Forno Luce']?.slug ?? ''}/libreria`,
    computerOnly: true,
    prepare: async (page, s) => {
      await folders(page, s)
      const column = page.getByRole('navigation', { name: 'Cartelle' })
      await column.locator('[data-folder="Novembre"]').hover()
      await column.getByRole('button', { name: 'Azioni per la cartella Novembre' }).click()
      await page.getByRole('menu').waitFor()
      await page.waitForTimeout(300)
    },
  },
  // one library (Task 10 of stage 7): the clients' tree, then a client with a folder open
  {
    id: '29-libreria-albero',
    path: (s) => `/${s.org}/libreria`,
    computerOnly: true,
    prepare: async (page, s) => {
      await folders(page, s)
      await page.getByRole('button', { name: 'Cartelle di Forno Luce' }).click()
      await page.locator('[data-tree-folder="Reel"]').waitFor()
      await page.mouse.move(0, 0)
    },
  },
  {
    id: '30-libreria-cliente',
    path: (s) => `/${s.org}/libreria?spazio=${s.clients['Forno Luce']?.slug ?? ''}`,
    prepare: folders,
  },
  // «Dalla libreria» of the editor with the client's folders (Task 10 of stage 7)
  {
    id: '31-editor-dalla-libreria',
    path: (s) => `/${s.org}/spazi/${s.clients['Forno Luce']?.slug ?? ''}/post/nuovo`,
    prepare: async (page, s) => {
      await folders(page, s)
      if ((page.viewportSize()?.width ?? 1440) < 768) {
        await page.locator('[data-add-file]').click()
        await page.getByRole('menuitem', { name: 'Dalla libreria' }).click()
      } else await page.getByRole('button', { name: 'Dalla libreria' }).click()
      const dialog = page.getByRole('dialog', { name: 'Scegli dalla libreria' })
      await dialog.waitFor()
      await page.waitForTimeout(400)
    },
  },
  // a zip into the library, its preview with a folder of the same name there (Task 10 of stage 7)
  {
    id: '32-libreria-zip',
    path: (s) => `/${s.org}/libreria?spazio=${s.clients['Forno Luce']?.slug ?? ''}`,
    prepare: async (page, s) => {
      await folders(page, s)
      const photo = new Uint8Array(2048).fill(1)
      const names = [
        'novembre/reel/forno-01.mp4',
        'novembre/reel/forno-02.mp4',
        'novembre/copertine/pane.jpg',
        'novembre/copertine/cornetti.jpg',
        'novembre/vetrina.jpg',
        '__MACOSX/novembre/._vetrina.jpg',
        'novembre/note.txt',
      ]
      await page.locator('[data-zip-input]').setInputFiles({
        name: 'novembre.zip',
        mimeType: 'application/zip',
        buffer: storedZip(names.map((name) => ({ name, data: photo }))),
      })
      await page
        .getByRole('dialog', { name: 'Carica uno zip' })
        .locator('[data-tree-summary]')
        .waitFor()
      await page.waitForTimeout(400)
    },
  },
  // people and settings (Task R8)
  { id: '21-utenti', path: (s) => `/${s.org}/utenti` },
  {
    id: '22-invita',
    path: (s) => `/${s.org}/utenti`,
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Invita' }).locator('visible=true').first().click()
      const dialog = page.getByRole('dialog', { name: 'Invita una persona' })
      await dialog.getByLabel('Email').fill('luca@studioriva.example')
      for (const name of ['Forno Luce', 'Osteria Bruna']) {
        await dialog.getByRole('button', { name: 'Aggiungi un cliente' }).click()
        // under the stopped clock a click does not tick a Reka menu's box: Enter does
        await page.getByRole('menuitemcheckbox', { name }).focus()
        await page.keyboard.press('Enter')
        await page.keyboard.press('Escape')
      }
      // the menu gives the focus back to «Aggiungi» once it has closed: then it is taken away
      await page.waitForTimeout(400)
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      })
      await page.mouse.move(0, 0)
      await page.waitForTimeout(100)
    },
  },
  { id: '23-impostazioni-profilo', path: () => '/account' },
  { id: '24-impostazioni-sicurezza', path: () => '/account/sicurezza' },
  { id: '25-impostazioni-meta', path: (s) => `/${s.org}/impostazioni/integrazioni/meta` },
  { id: '26-registro-attivita', path: (s) => `/${s.org}/impostazioni/registro` },
]

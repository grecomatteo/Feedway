import { mkdir, writeFile } from 'node:fs/promises'
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { DESIGN_NOW } from '../e2e/support/design-sample.ts'
import { newWorkspace } from '../e2e/support/meta.ts'
import { newPerson, ownAddress, signInWithTotp } from '../e2e/support/people.ts'
import { BOARDS, board, outputDir } from './board.ts'

// The states the references do not draw (plan of the redesign, Task R9): every main page empty,
// loading and after a read that failed, at 1440×900 and 390×844, light (or DESIGN_THEME=dark).
// `pnpm --filter @app/web design:states`. A read is held for «caricamento» and answered with a 500
// for «errore», in the browser: the pages read their lists there, not on the server.

test.use({ baseURL: process.env.E2E_BASE_URL })

const THEME = process.env.DESIGN_THEME === 'dark' ? 'dark' : 'light'
const CODE = new URL(`../../../../design/reviews/ridisegno/stati/${THEME}/`, import.meta.url)

type Kind = 'vuoto' | 'caricamento' | 'errore'
interface Agency {
  org: string
  slug: string
}
interface StateShot {
  page: string
  kind: Kind
  path: (a: Agency) => string
  /** the reads to hold (caricamento) or to fail (errore) */
  reads?: RegExp
  /** before the agency has any client (the first empty states) */
  noClient?: boolean
  prepare?: (page: Page) => Promise<void>
}

const AGENDA = /\/orgs\/[^/]+\/agenda(\?|\/)/
const CLIENTS = /\/orgs\/[^/]+\/workspaces(\?|$)/
const CLIENT = /\/orgs\/[^/]+\/(agenda\?|workspaces\/[^/]+\/(accounts|members|profiles)(\?|$))/
const POSTS = /\/workspaces\/[^/]+\/posts(\?|$)/
const CONTENT = /\/workspaces\/[^/]+\/(labels|caption-templates|account-groups)(\?|$)/
const MEDIA = /\/orgs\/[^/]+\/media(\?|$)/
const PEOPLE = /\/orgs\/[^/]+\/(members|invites)(\?|$)/
const LOG = /\/audit-log(\?|$)/
const META = /\/orgs\/[^/]+\/(accounts|connections)(\?|$)/

const each = (page: string, path: StateShot['path'], reads: RegExp): StateShot[] => [
  { page, kind: 'caricamento', path, reads },
  { page, kind: 'errore', path, reads },
]

const SHOTS: StateShot[] = [
  { page: 'oggi-senza-clienti', kind: 'vuoto', path: (a) => `/${a.org}`, noClient: true },
  { page: 'clienti', kind: 'vuoto', path: (a) => `/${a.org}/spazi`, noClient: true },
  {
    page: 'libreria-senza-clienti',
    kind: 'vuoto',
    path: (a) => `/${a.org}/libreria`,
    noClient: true,
  },
  { page: 'oggi', kind: 'vuoto', path: (a) => `/${a.org}` },
  ...each('oggi', (a) => `/${a.org}`, AGENDA),
  ...each('clienti', (a) => `/${a.org}/spazi`, CLIENTS),
  { page: 'cliente', kind: 'vuoto', path: (a) => `/${a.org}/spazi/${a.slug}` },
  ...each('cliente', (a) => `/${a.org}/spazi/${a.slug}`, CLIENT),
  { page: 'post-del-cliente', kind: 'vuoto', path: (a) => `/${a.org}/spazi/${a.slug}/post` },
  ...each('post-del-cliente', (a) => `/${a.org}/spazi/${a.slug}/post`, POSTS),
  { page: 'contenuti', kind: 'vuoto', path: (a) => `/${a.org}/spazi/${a.slug}/contenuti` },
  ...each('contenuti', (a) => `/${a.org}/spazi/${a.slug}/contenuti`, CONTENT),
  { page: 'libreria', kind: 'vuoto', path: (a) => `/${a.org}/libreria` },
  ...each('libreria', (a) => `/${a.org}/libreria`, MEDIA),
  {
    page: 'utenti-inviti',
    kind: 'vuoto',
    path: (a) => `/${a.org}/utenti`,
    prepare: async (page) => {
      await page.getByRole('button', { name: /^Inviti/ }).click()
    },
  },
  ...each('utenti', (a) => `/${a.org}/utenti`, PEOPLE),
  ...each('registro', (a) => `/${a.org}/impostazioni/registro`, LOG),
  { page: 'meta', kind: 'vuoto', path: (a) => `/${a.org}/impostazioni/integrazioni/meta` },
  ...each('meta', (a) => `/${a.org}/impostazioni/integrazioni/meta`, META),
]

const SIZES = {
  computer: { width: 1440, height: 900, isMobile: false },
  telefono: { width: 390, height: 844, isMobile: true },
} as const
type Size = keyof typeof SIZES

async function shoot(context: BrowserContext, shot: StateShot, agency: Agency) {
  const page = await context.newPage()
  await ownAddress(page)
  await page.clock.setFixedTime(DESIGN_NOW)
  if (shot.reads && shot.kind === 'caricamento')
    await page.route(shot.reads, () => {
      // never answered: the page stays on its skeleton
    })
  if (shot.reads && shot.kind === 'errore')
    await page.route(shot.reads, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    )
  await page.goto(shot.path(agency))
  await page.waitForLoadState('load')
  const shown = {
    vuoto: '[data-empty-state], [data-today-empty], [data-clients-none], [data-ready]',
    caricamento: '[data-skeleton-row], [role="status"], [aria-busy="true"]',
    errore: '[role="alert"]',
  }[shot.kind]
  await page
    .locator(shown)
    .locator('visible=true')
    .first()
    .waitFor({ timeout: 5_000 })
    .catch(() => {
      console.warn(`design:states: ${shot.page} ${shot.kind} shows none of ${shown}`)
    })
  await shot.prepare?.(page)
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({
    content:
      '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}',
  })
  await page.mouse.move(0, 0)
  await page.waitForTimeout(400)
  const png = await page.screenshot()
  await page.close()
  return png
}

async function boards(
  browser: Browser,
  taken: Record<Size, Record<Kind, { name: string; png: Buffer }[]>>,
) {
  const dir = await outputDir(`${BOARDS}/stati-${THEME === 'dark' ? 'scuro' : 'chiaro'}`)
  for (const size of Object.keys(SIZES) as Size[])
    for (const kind of ['vuoto', 'caricamento', 'errore'] as const) {
      const shots = taken[size][kind]
      if (!shots.length) continue
      const title = `Stati · ${kind} · ${size}`
      const png = await board(browser, shots, size === 'computer' ? 3 : 6, title, THEME === 'dark')
      await writeFile(`${dir}/${kind}-${size}.png`, png)
    }
}

test('design states', async ({ browser }) => {
  const contexts = {} as Record<Size, BrowserContext>
  for (const size of Object.keys(SIZES) as Size[]) {
    const s = SIZES[size]
    contexts[size] = await browser.newContext({
      viewport: { width: s.width, height: s.height },
      deviceScaleFactor: 1,
      colorScheme: THEME,
      isMobile: s.isMobile,
      hasTouch: s.isMobile,
      ...(process.env.E2E_BASE_URL && { baseURL: process.env.E2E_BASE_URL }),
    })
  }
  // an agency of its own, signed in on both sizes, first without any client
  const owner = await newPerson('Giulia Ferri', 'owner')
  await signInWithTotp(contexts.computer.request, owner)
  await contexts.telefono.addCookies(await contexts.computer.cookies())
  const agency: Agency = { org: owner.organizationSlug, slug: '' }

  const taken = Object.fromEntries(
    (Object.keys(SIZES) as Size[]).map((size) => [
      size,
      { vuoto: [], caricamento: [], errore: [] },
    ]),
  ) as unknown as Record<Size, Record<Kind, { name: string; png: Buffer }[]>>

  for (const shot of SHOTS) {
    if (!shot.noClient && !agency.slug)
      agency.slug = (await newWorkspace(contexts.computer.request, agency.org, 'Forno Luce')).slug
    for (const size of Object.keys(SIZES) as Size[]) {
      const png = await shoot(contexts[size], shot, agency)
      const name = `${shot.page}-${shot.kind}`
      await mkdir(new URL(`${size}/`, CODE), { recursive: true })
      await writeFile(new URL(`${size}/${name}.png`, CODE), png)
      taken[size][shot.kind].push({ name: shot.page, png })
    }
  }
  await boards(browser, taken)
  for (const c of Object.values(contexts)) await c.close()
})

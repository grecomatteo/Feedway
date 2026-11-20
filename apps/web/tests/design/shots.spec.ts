import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test, type Browser, type Page } from '@playwright/test'
import { designSample, DESIGN_NOW } from '../e2e/support/design-sample.ts'
import { ownAddress } from '../e2e/support/people.ts'
import { SCREENS, type Screen } from './screens.ts'

// The code next to its reference (plan of the redesign, «Come si prova la fedeltà»): every screen
// of SCREENS (or only the numbers in DESIGN_SHOTS, «02 04») at 1440×900 and 390×844, on the sample
// agency, with the browser stopped at Thursday 19 November 2026 10:00 in Rome. Each shot goes to
// design/reviews/ridisegno/codice/{computer,telefono}/, and an image with the reference on the
// left and the code on the right goes to DESIGN_COMPARE_DIR.

test.use({ baseURL: process.env.E2E_BASE_URL })

const repo = new URL('../../../../', import.meta.url)
const REFERENCE = new URL('design/esplorazioni/2026-11-19-nuova-direzione/schermate/', repo)
const CODE = new URL('design/reviews/ridisegno/codice/', repo)
const COMPARE =
  process.env.DESIGN_COMPARE_DIR ?? '/mnt/project-files/design-revisione/ridisegno/confronti'

/** DESIGN_COMPARE_DIR, or a temporary folder where that one cannot be written (outside the cloud). */
async function compareDir() {
  try {
    await mkdir(COMPARE, { recursive: true })
    return COMPARE
  } catch {
    // a new private folder each time, never a fixed name others could have prepared
    const dir = await mkdtemp(`${tmpdir()}/feedway-confronti-`)
    console.warn(`design:shots: ${COMPARE} cannot be written, the comparisons go to ${dir}`)
    return dir
  }
}

const SIZES = {
  computer: { width: 1440, height: 900, fullPage: true, isMobile: false },
  telefono: { width: 390, height: 844, fullPage: false, isMobile: true },
} as const
type Size = keyof typeof SIZES

const wanted = (process.env.DESIGN_SHOTS ?? '').split(/[\s,]+/).filter(Boolean)
const screens = SCREENS.filter((s) => !wanted.length || wanted.some((w) => s.id.startsWith(w)))

/** Reference and code side by side, at the same scale, drawn by the browser itself. */
async function compose(browser: Browser, reference: Buffer, code: Buffer, title: string) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  const src = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#e9e6df;font:13px system-ui">
    <div style="display:flex;gap:24px;padding:16px;align-items:flex-start">
      <figure style="margin:0;flex:1"><figcaption style="margin-bottom:6px">Riferimento · ${title}</figcaption>
        <img src="${src(reference)}" style="width:100%;display:block;outline:1px solid #0002"></figure>
      <figure style="margin:0;flex:1"><figcaption style="margin-bottom:6px">Codice · ${title}</figcaption>
        <img src="${src(code)}" style="width:100%;display:block;outline:1px solid #0002"></figure>
    </div></body></html>`)
  const out = await page.screenshot({ fullPage: true })
  await page.close()
  return out
}

async function shoot(
  page: Page,
  screen: Screen,
  size: Size,
  sample: Awaited<ReturnType<typeof designSample>>,
) {
  const s = SIZES[size]
  await page.setViewportSize({ width: s.width, height: s.height })
  await page.goto(screen.path(sample))
  await page.waitForLoadState('networkidle')
  await page
    .locator('[data-ready]')
    .first()
    .waitFor({ timeout: 2_000 })
    .catch(() => {
      // not every page marks itself ready: shoot it anyway, but say so
      console.warn(`design:shots: ${screen.id} (${size}) has no [data-ready] after 2 s`)
    })
  await screen.prepare?.(page, sample)
  await page.evaluate(() => document.fonts.ready)
  // the caret and the transitions would make two shots of the same page differ
  await page.addStyleTag({
    content:
      '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}',
  })
  return page.screenshot({ fullPage: s.fullPage })
}

test('design shots', async ({ browser }) => {
  // one context per size: the phone needs touch and its own user agent
  const newContext = (size: Size) => {
    const s = SIZES[size]
    return browser.newContext({
      viewport: { width: s.width, height: s.height },
      deviceScaleFactor: 1,
      isMobile: s.isMobile,
      hasTouch: s.isMobile,
      ...(process.env.E2E_BASE_URL && { baseURL: process.env.E2E_BASE_URL }),
    })
  }
  const contexts = Object.fromEntries(
    await Promise.all(
      (Object.keys(SIZES) as Size[]).map(async (size) => [size, await newContext(size)] as const),
    ),
  ) as Record<Size, Awaited<ReturnType<Browser['newContext']>>>

  const compare = await compareDir()
  const first = await contexts.computer.newPage()
  await ownAddress(first)
  const sample = await designSample(first)
  // the phone signs in with the same cookies
  await contexts.telefono.addCookies(await contexts.computer.cookies())

  for (const size of Object.keys(SIZES) as Size[]) {
    const page = size === 'computer' ? first : await contexts[size].newPage()
    if (size !== 'computer') await ownAddress(page)
    await page.clock.setFixedTime(DESIGN_NOW)
    await mkdir(new URL(`${size}/`, CODE), { recursive: true })
    for (const screen of screens) {
      if (screen.computerOnly && size !== 'computer') continue
      if (screen.phoneOnly && size === 'computer') continue
      let code: Buffer
      if (screen.signedOut) {
        // a context of its own, without the sample's cookies
        const out = await newContext(size)
        const outPage = await out.newPage()
        await ownAddress(outPage)
        await outPage.clock.setFixedTime(DESIGN_NOW)
        code = await shoot(outPage, screen, size, sample)
        await out.close()
      } else code = await shoot(page, screen, size, sample)
      await writeFile(new URL(`${size}/${screen.id}.png`, CODE), code)
      const ref = new URL(`${size}/${screen.id}.png`, REFERENCE)
      if (!existsSync(ref)) continue
      const side = await compose(browser, await readFile(ref), code, `${screen.id} · ${size}`)
      await writeFile(`${compare}/${screen.id}-${size}.png`, side)
    }
  }
  for (const c of Object.values(contexts)) await c.close()
})

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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

async function shoot(page: Page, screen: Screen, size: Size, sample: Awaited<ReturnType<typeof designSample>>) {
  const s = SIZES[size]
  await page.setViewportSize({ width: s.width, height: s.height })
  await page.goto(screen.path(sample))
  await page.waitForLoadState('networkidle')
  await page.locator('[data-ready]').first().waitFor({ timeout: 2_000 }).catch(() => undefined)
  await screen.prepare?.(page, sample)
  await page.evaluate(() => document.fonts.ready)
  // the caret and the transitions would make two shots of the same page differ
  await page.addStyleTag({
    content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}',
  })
  return page.screenshot({ fullPage: s.fullPage })
}

test('design shots', async ({ browser }) => {
  // one context per size: the phone needs touch and its own user agent
  const contexts = Object.fromEntries(
    await Promise.all(
      (Object.keys(SIZES) as Size[]).map(async (size) => {
        const s = SIZES[size]
        const context = await browser.newContext({
          viewport: { width: s.width, height: s.height },
          deviceScaleFactor: 1,
          isMobile: s.isMobile,
          hasTouch: s.isMobile,
          ...(process.env.E2E_BASE_URL && { baseURL: process.env.E2E_BASE_URL }),
        })
        return [size, context] as const
      }),
    ),
  ) as Record<Size, Awaited<ReturnType<Browser['newContext']>>>

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
      const code = await shoot(page, screen, size, sample)
      await writeFile(new URL(`${size}/${screen.id}.png`, CODE), code)
      const ref = new URL(`${size}/${screen.id}.png`, REFERENCE)
      if (!existsSync(ref)) continue
      await mkdir(COMPARE, { recursive: true })
      const side = await compose(browser, await readFile(ref), code, `${screen.id} · ${size}`)
      await writeFile(`${COMPARE}/${screen.id}-${size}.png`, side)
    }
  }
  for (const c of Object.values(contexts)) await c.close()
})

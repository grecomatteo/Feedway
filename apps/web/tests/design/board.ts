import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { Browser } from '@playwright/test'

/** Where the boards of Task R9 go: dark, the other palettes and the states, for Matteo. */
export const BOARDS =
  process.env.DESIGN_BOARD_DIR ?? '/mnt/project-files/design-revisione/ridisegno/scuro-e-stati'

/** `wanted`, or a temporary folder where that one cannot be written (outside the cloud). */
export async function outputDir(wanted: string) {
  try {
    await mkdir(wanted, { recursive: true })
    return wanted
  } catch {
    // a new private folder each time, never a fixed name others could have prepared
    const dir = await mkdtemp(`${tmpdir()}/feedway-design-`)
    console.warn(`design:shots: ${wanted} cannot be written, the images go to ${dir}`)
    return dir
  }
}

/**
 * Several shots on one board, each with its name above, `columns` to a row, drawn by the browser.
 * A computer shot is cut at the first screen (900), so a long page does not stretch its row.
 */
export async function board(
  browser: Browser,
  shots: { name: string; png: Buffer }[],
  columns: number,
  title: string,
  dark: boolean,
) {
  const page = await browser.newPage({ viewport: { width: 2400, height: 900 } })
  const src = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`
  const cells = shots
    .map(
      (s) => `<figure style="margin:0"><figcaption style="margin-bottom:6px">${s.name}</figcaption>
        <div style="aspect-ratio:${columns > 4 ? '390/844' : '1440/900'};overflow:hidden;outline:1px solid #8884;border-radius:6px">
        <img src="${src(s.png)}" style="width:100%;display:block"></div></figure>`,
    )
    .join('')
  await page.setContent(`<!doctype html><html><body style="margin:0;padding:24px;background:${dark ? '#0d0d0c' : '#e9e6df'};color:${dark ? '#eee' : '#222'};font:15px system-ui">
    <h1 style="font-size:22px;margin:0 0 16px">${title}</h1>
    <div style="display:grid;grid-template-columns:repeat(${String(columns)},1fr);gap:24px 20px">${cells}</div>
    </body></html>`)
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())))
  const out = await page.screenshot({ fullPage: true })
  await page.close()
  return out
}

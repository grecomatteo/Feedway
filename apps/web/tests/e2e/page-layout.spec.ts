import { expect, test, type Page } from '@playwright/test'
import { seed } from '@app/infrastructure/testing'
import { newPerson, ownAddress, signInWithTotp } from './support/people.ts'

// One structure for every page (D-63, DESIGN.md «Struttura delle pagine»): the title starts at the
// same place on every page, with the margins of the layout scale, and the page uses the whole
// width beside the sidebar; only forms and long text are narrower.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

async function frame(page: Page) {
  const main = page.locator('#main')
  const title = page.getByRole('heading', { level: 1 }).first()
  await expect(title).toBeVisible()
  // the head of the page: on a client's page the photo comes before the title
  const head = title.locator('xpath=ancestor::header[1]')
  const [m, t] = await Promise.all([main.boundingBox(), head.boundingBox()])
  if (!m || !t) throw new Error('page not on screen')
  const padding = await main.evaluate((el) => {
    const s = getComputedStyle(el)
    return { left: parseFloat(s.paddingLeft), right: parseFloat(s.paddingRight) }
  })
  return { left: t.x - m.x, top: t.y - m.y, mainRight: m.x + m.width, padding }
}

test('every page of the agency has the same margins and the whole width', async ({ page }) => {
  const owner = await newPerson('Olga Struttura', 'owner')
  const org = owner.organizationSlug
  const client = await seed(process.env.E2E_DATABASE_URL ?? '', (s) =>
    s.workspace(org, { name: 'Forno Luce' }),
  )
  await signInWithTotp(page.request, owner)
  const phone = (page.viewportSize()?.width ?? 1280) < 768
  const gutter = phone ? 16 : 32
  const pages = [
    `/${org}`,
    `/${org}/spazi`,
    `/${org}/spazi/${client}`,
    `/${org}/libreria?spazio=${client}`,
    `/${org}/utenti`,
    `/${org}/registro`,
    `/${org}/impostazioni`,
    '/account',
  ]
  const seen = []
  for (const path of pages) {
    await page.goto(path)
    seen.push({ path, ...(await frame(page)) })
  }
  const width = page.viewportSize()?.width ?? 0
  for (const s of seen) {
    expect(s.padding, s.path).toEqual({ left: gutter, right: gutter })
    expect(s.left, s.path).toBe(gutter)
    expect(s.top, s.path).toBeCloseTo(seen[0]?.top ?? 0, 0)
    // nothing narrows the page: main reaches the right edge of the window
    expect(s.mainRight, s.path).toBeCloseTo(width, 0)
  }
  // a list uses the whole width; a form stays as wide as what it holds
  if (!phone) {
    await page.goto(`/${org}/spazi`)
    const list = await page.getByRole('table').boundingBox()
    // the sidebar is 240 px wide (D-81)
    expect(Math.abs((list?.width ?? 0) - (width - 240 - 2 * gutter))).toBeLessThanOrEqual(2)
  }
  await page.goto(`/${org}/impostazioni`)
  const field = await page.getByRole('textbox', { name: /Nome dell'agenzia/ }).boundingBox()
  expect(field?.width ?? 0).toBeLessThanOrEqual(40 * 16)
})

import { expect, test, type Page } from '@playwright/test'
import { seed } from '@app/infrastructure/testing'
import { addPerson, newPerson, ownAddress, signInWithTotp } from './support/people.ts'

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
    `/${org}/impostazioni/registro`,
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

test('between 1024 and 1280 px nothing runs off the page: Utenti, the client picker (D-102)', async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 1280) < 768, 'the sidebar is on a computer')
  const owner = await newPerson('Olga Larghezze', 'owner')
  const org = owner.organizationSlug
  const client = await seed(process.env.E2E_DATABASE_URL ?? '', (s) =>
    s.workspace(org, { name: 'Forno Luce' }),
  )
  // a person of a client fills every column, as in a real agency
  await addPerson(org, 'Marta Manager', 'member', [{ workspaceId: client, role: 'manager' }])
  await signInWithTotp(page.request, owner)
  // the page, or any box inside it, wider than the room it has
  const overflow = () =>
    page.evaluate(() => {
      // the window, not #main: a grid too wide stretches #main with it
      const room = document.documentElement.clientWidth
      let worst = document.documentElement.scrollWidth - document.documentElement.clientWidth
      for (const el of Array.from(document.querySelectorAll('#main *'))) {
        const r = el.getBoundingClientRect()
        if (r.width > 0) worst = Math.max(worst, Math.round(r.right - room))
        // a box that scrolls sideways (text cut with an ellipsis does not count)
        if (
          el.scrollWidth > el.clientWidth + 1 &&
          ['auto', 'scroll'].includes(getComputedStyle(el).overflowX)
        )
          worst = Math.max(worst, el.scrollWidth - el.clientWidth)
      }
      return worst
    })
  for (const width of [1024, 1160, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(`/${org}/utenti`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText('Marta Manager').first()).toBeVisible()
    expect(await overflow(), `Utenti a ${String(width)} px`).toBeLessThanOrEqual(0)
    // inside the row too: the clients stay readable and no cell runs into the next one
    const row = page.locator('[data-member-row]', { hasText: 'Marta Manager' })
    const cells = await row.getByRole('cell').evaluateAll((els) =>
      els.map((el) => ({
        text: el.textContent.trim(),
        width: el.getBoundingClientRect().width,
        spills:
          getComputedStyle(el).textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1,
      })),
    )
    const clients = cells.find((c) => c.text.includes('Forno Luce'))
    expect(clients?.width ?? 0, `Clienti a ${String(width)} px`).toBeGreaterThanOrEqual(80)
    expect(
      cells.filter((c) => c.spills).map((c) => c.text),
      `Utenti a ${String(width)} px`,
    ).toEqual([])
  }
  // the list of the client picker scrolls only up and down
  await page.goto(`/${org}`)
  await page
    .getByRole('button', { name: /^Contesto:/ })
    .locator('visible=true')
    .first()
    .click()
  const list = page.getByRole('listbox').first()
  await expect(list).toBeVisible()
  // the line above the first client reaches the edges of the panel: it may be clipped, never scrolled
  const sideways = await list.evaluate((el) =>
    getComputedStyle(el).overflowX === 'hidden' ? 0 : el.scrollWidth - el.clientWidth,
  )
  expect(sideways).toBeLessThanOrEqual(0)
})

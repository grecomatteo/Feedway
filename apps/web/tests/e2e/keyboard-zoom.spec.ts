import { expect, test, type Locator, type Page } from '@playwright/test'
import { newWorkspace } from './support/meta.ts'
import { newPerson, signInWithTotp } from './support/people.ts'

// Keyboard and zoom on the four pages used most (plan of the redesign, Task R9): Oggi, Clienti,
// the editor and Libreria. With the keyboard alone the page's main action is reached, and every
// stop on the way is on screen and shows where the focus is (WCAG 2.1.1, 2.4.7, 2.4.11). At 200%
// zoom (a 1280×800 screen becomes 640×400) nothing goes sideways and the action is still there
// (WCAG 1.4.4, 1.4.10).

test.use({ baseURL: process.env.E2E_BASE_URL })

interface MainPage {
  name: string
  path: (org: string, client: string) => string
  action: (page: Page) => Locator
}

const PAGES: MainPage[] = [
  {
    name: 'Oggi',
    path: (org) => `/${org}`,
    action: (page) => page.getByRole('link', { name: 'Nuovo post' }),
  },
  {
    name: 'Clienti',
    path: (org) => `/${org}/spazi`,
    action: (page) => page.getByRole('button', { name: 'Nuovo cliente' }),
  },
  {
    // «Programma» waits for a destination and a text: the first field of the post is the goal
    name: 'Editor',
    path: (org, client) => `/${org}/spazi/${client}/post/nuovo`,
    action: (page) => page.getByRole('textbox', { name: 'Testo comune' }),
  },
  {
    name: 'Libreria',
    path: (org) => `/${org}/libreria`,
    action: (page) => page.getByRole('button', { name: 'Carica', exact: true }),
  },
]

test.beforeEach(({ baseURL }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
})

async function agency(page: Page) {
  const owner = await newPerson('Tina Tastiera', 'owner')
  await signInWithTotp(page.request, owner)
  const client = await newWorkspace(page.request, owner.organizationSlug, 'Forno Tasti')
  return { org: owner.organizationSlug, client: client.slug }
}

/** What the focused element looks like: on screen, and with an outline or a ring around it. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return null
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return {
      name: (el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 40),
      onScreen: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0,
      ring: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none',
    }
  })

for (const p of PAGES) {
  test(`${p.name}: the keyboard reaches the main action, every stop on screen and marked`, async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'a keyboard: computer only')
    const { org, client } = await agency(page)
    await page.goto(p.path(org, client))
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    const action = p.action(page).locator('visible=true').first()
    await expect(action).toBeVisible()

    let reached = false
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab')
      const f = await focused(page)
      if (!f) continue
      expect(f.onScreen, `stop ${String(i + 1)} (${f.name}) on screen`).toBe(true)
      expect(f.ring, `stop ${String(i + 1)} (${f.name}) shows the focus`).toBe(true)
      reached = await action.evaluate((el) => el === document.activeElement)
    }
    expect(reached, `${p.name}: the main action is reached with Tab`).toBe(true)
  })

  test(`${p.name}: at 200% zoom nothing goes sideways and the action is there`, async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'the zoom of a computer screen')
    await page.setViewportSize({ width: 640, height: 400 })
    const { org, client } = await agency(page)
    await page.goto(p.path(org, client))
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    const action = p.action(page).locator('visible=true').first()
    await action.scrollIntoViewIfNeeded()
    await expect(action).toBeInViewport()
  })
}

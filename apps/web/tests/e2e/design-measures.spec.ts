import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { newMember, signIn } from './support/people.ts'

// The measures of the new direction (D-81, base.css of the exploration), read from the computed
// styles of the pages already redrawn: controls 36 on a computer and 44 on a phone, rows 52 / 60,
// text 14 / 15, section titles in the system font, one orange background per screen. Every task
// of the redesign adds its pages to PAGES (plan, «Come si prova la fedeltà», point 5).

test.use({ baseURL: process.env.E2E_BASE_URL })

interface MeasuredPage {
  name: string
  path: string
  /** a control of the page: a button or a field */
  control: string
  /** a row of a list, if the page has one */
  row?: string
}

const PAGES: MeasuredPage[] = [
  {
    name: 'system board',
    path: '/__test/sistema',
    control: '[data-sample="outline"]',
    row: '[data-list-row]',
  },
]

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768
const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await signIn(page.request, await newMember('Mara Misure'))
})

for (const p of PAGES) {
  test(`${p.name}: the measures of the new direction`, async ({ page }) => {
    await page.goto(p.path)
    await expect(page.locator('[data-ready]')).toHaveCount(1)
    const phone = isPhone(page)

    const control = await page.locator(p.control).first().boundingBox()
    expect(Math.round(control?.height ?? 0), 'control height').toBe(phone ? 44 : 36)
    if (p.row) {
      const row = await page.locator(p.row).filter({ visible: true }).first().boundingBox()
      expect(Math.round(row?.height ?? 0), 'row height').toBeGreaterThanOrEqual(phone ? 60 : 52)
    }

    const type = await page.evaluate(() => {
      const css = (el: Element | null) => (el ? getComputedStyle(el) : null)
      const body = css(document.body)
      const h2 = css(document.querySelector('h2'))
      return {
        body: body?.fontSize,
        numbers: body?.fontVariantNumeric,
        h2Size: h2?.fontSize,
        h2Weight: h2?.fontWeight,
        h2Family: h2?.fontFamily,
      }
    })
    expect(type.body, 'text size').toBe(phone ? '15px' : '14px')
    expect(type.numbers).toContain('tabular-nums')
    expect(type.h2Size, 'section title size').toBe('14px')
    expect(type.h2Weight).toBe('600')
    expect(type.h2Family).not.toMatch(/^"?Sora/)

    // one orange per screen: the action that moves the work on (the count of «Da sistemare» and
    // the colour samples of the board are not actions)
    const orange = await page.evaluate(() => {
      const probe = document.createElement('i')
      probe.style.background = 'var(--app-brand)'
      document.body.append(probe)
      const brand = getComputedStyle(probe).backgroundColor
      probe.remove()
      return [...document.querySelectorAll<HTMLElement>('body *')].filter(
        (el) =>
          !el.closest('[data-swatch], [data-count]') &&
          el.checkVisibility() &&
          getComputedStyle(el).backgroundColor === brand,
      ).length
    })
    expect(orange, 'elements on the orange').toBeLessThanOrEqual(1)

    // nothing goes past the content width or sideways on a phone
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    expect((await axe(page)).violations).toEqual([])
  })
}

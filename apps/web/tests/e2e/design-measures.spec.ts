import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { newWorkspace } from './support/meta.ts'
import { newMember, newPerson, signIn, signInWithTotp } from './support/people.ts'

// The measures of the new direction (D-81, base.css of the exploration), read from the computed
// styles of the pages already redrawn: controls 36 on a computer and 44 on a phone, rows 52 / 60,
// text 14 / 15, section titles in the system font, one orange background per screen. Every task
// of the redesign adds its pages to PAGES (plan, «Come si prova la fedeltà», point 5).

test.use({ baseURL: process.env.E2E_BASE_URL })

interface MeasuredPage {
  name: string
  /** the address, or what makes the page's data and gives its address */
  path: string | ((page: Page) => Promise<string>)
  /** a control of the page: a button or a field */
  control: string
  /** a row of a list, if the page has one */
  row?: string
  /** the page title's size when it is not 22: [computer, phone] */
  title?: [string, string]
}

const PAGES: MeasuredPage[] = [
  {
    name: 'system board',
    path: '/__test/sistema',
    control: '[data-sample="outline"]',
    row: '[data-list-row]',
  },
  {
    // an Owner with a client and nothing planned: the outline «Nuovo post» of the empty week
    name: 'Oggi',
    path: async (page) => {
      const owner = await newPerson('Mara Oggi', 'owner')
      await signInWithTotp(page.request, owner)
      await newWorkspace(page.request, owner.organizationSlug, 'Cliente Misure')
      return `/${owner.organizationSlug}`
    },
    control: '[data-today-empty] a',
  },
  {
    // an Owner with a client: the outline «Nuovo cliente», the search and a row (screen 14)
    name: 'Clienti',
    path: async (page) => {
      const owner = await newPerson('Mara Clienti', 'owner')
      await signInWithTotp(page.request, owner)
      await newWorkspace(page.request, owner.organizationSlug, 'Cliente Misure')
      return `/${owner.organizationSlug}/spazi`
    },
    control: '[data-toolbar] > div:has(input[type="search"])',
    row: '[data-list-row]',
  },
  {
    // a client's calendar on its list (plan 09 Task 3, in place of «Post»): «Mostra altri»
    name: 'Calendario del cliente',
    path: async (page) => {
      const owner = await newPerson('Mara Post', 'owner')
      await signInWithTotp(page.request, owner)
      const ws = await newWorkspace(page.request, owner.organizationSlug, 'Cliente Misure')
      return `/${owner.organizationSlug}/spazi/${ws.slug}/calendario?vista=elenco`
    },
    control: '[data-list-more]',
  },
  {
    // the usual time's select and the outline «Nuova etichetta» (screen 18)
    name: 'Contenuti',
    path: async (page) => {
      const owner = await newPerson('Mara Contenuti', 'owner')
      await signInWithTotp(page.request, owner)
      const ws = await newWorkspace(page.request, owner.organizationSlug, 'Cliente Misure')
      return `/${owner.organizationSlug}/spazi/${ws.slug}/contenuti`
    },
    control: '[data-content-settings] button[role="combobox"]',
  },
  {
    // a new post (screen 08): the row at the top with its title in Sora 15 (16 on a phone), the
    // back arrow, the rows of the form; «Programma» is the only orange
    name: 'Editor',
    path: async (page) => {
      const owner = await newPerson('Mara Editor', 'owner')
      await signInWithTotp(page.request, owner)
      const ws = await newWorkspace(page.request, owner.organizationSlug, 'Cliente Misure')
      return `/${owner.organizationSlug}/spazi/${ws.slug}/post/nuovo`
    },
    control: '[data-editor-bar] a',
    title: ['15px', '16px'],
  },
  {
    // the library of every client (screen 19): the search «Cerca per nome o tag»
    name: 'Libreria',
    path: async (page) => {
      const owner = await newPerson('Mara Libreria', 'owner')
      await signInWithTotp(page.request, owner)
      await newWorkspace(page.request, owner.organizationSlug, 'Cliente Misure')
      return `/${owner.organizationSlug}/libreria`
    },
    control: '[data-library-tools] > div:has(input[type="search"])',
  },
  {
    // the people of the agency (screen 21): the search, the outline «Invita», a row
    name: 'Utenti',
    path: async (page) => {
      const owner = await newPerson('Mara Utenti', 'owner')
      await signInWithTotp(page.request, owner)
      return `/${owner.organizationSlug}/utenti`
    },
    control: '[data-toolbar] > div:has(input[type="search"])',
    row: '[data-member-row]',
  },
  {
    // the person's profile (screen 23): the fields of the rows
    name: 'Profilo e preferenze',
    path: '/account',
    control: '[data-settings-row] input[type="text"]',
  },
  {
    // the activity log (screen 26): the search and a row
    name: 'Registro attività',
    path: async (page) => {
      const owner = await newPerson('Mara Registro', 'owner')
      await signInWithTotp(page.request, owner)
      await newWorkspace(page.request, owner.organizationSlug, 'Cliente Misure')
      return `/${owner.organizationSlug}/impostazioni/registro`
    },
    control: '[data-toolbar] > div:has(input[type="search"])',
    row: '[data-list-row]',
  },
]

/** How many things on the screen stand on the accent's orange. */
const oranges = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement('i')
    probe.style.background = 'var(--app-brand)'
    document.body.append(probe)
    const brand = getComputedStyle(probe).backgroundColor
    probe.remove()
    return [...document.querySelectorAll<HTMLElement>('body *')].filter(
      (el) =>
        !el.closest('[data-swatch], [data-count], [data-accent]') &&
        el.checkVisibility() &&
        getComputedStyle(el).backgroundColor === brand,
    ).length
  })

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768
const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await signIn(page.request, await newMember('Mara Misure'))
})

for (const p of PAGES) {
  test(`${p.name}: the measures of the new direction`, async ({ page }) => {
    await page.goto(typeof p.path === 'string' ? p.path : await p.path(page))
    await expect(page.locator('[data-ready]')).toHaveCount(1)
    const phone = isPhone(page)

    const control = await page.locator(p.control).first().boundingBox()
    expect(Math.round(control?.height ?? 0), 'control height').toBe(phone ? 44 : 36)
    if (p.row) {
      const row = await page.locator(p.row).filter({ visible: true }).first().boundingBox()
      expect(Math.round(row?.height ?? 0), 'row height').toBe(phone ? 60 : 52)
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
    // the section titles, where the page has some
    if (type.h2Size !== undefined) {
      expect(type.h2Size, 'section title size').toBe('14px')
      expect(type.h2Weight).toBe('600')
      expect(type.h2Family).not.toMatch(/^"?Sora/)
    }

    // the page title, where the page shows one: Sora 22 semibold, the only Sora on the screen
    const title = page.locator('h1').filter({ visible: true }).first()
    if ((await title.count()) && (await title.evaluate((el) => el.clientWidth > 1))) {
      const h1 = await title.evaluate((el) => {
        const css = getComputedStyle(el)
        return { size: css.fontSize, weight: css.fontWeight, family: css.fontFamily }
      })
      expect(h1.size, 'page title size').toBe(p.title ? p.title[phone ? 1 : 0] : '22px')
      expect(h1.weight).toBe('600')
      expect(h1.family).toMatch(/^"?Sora/)
    }
    // the content stops at 1200
    const shell = page.locator('[data-page-shell]').first()
    if (await shell.count()) {
      expect((await shell.boundingBox())?.width ?? 0, 'content width').toBeLessThanOrEqual(1200)
    }

    // one orange per screen: the action that moves the work on (the count of «Da sistemare» and
    // the colour samples of the board are not actions)
    expect(await oranges(page), 'elements on the orange').toBeLessThanOrEqual(1)

    // nothing goes past the content width or sideways on a phone
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    expect((await axe(page)).violations).toEqual([])
  })
}

// the pages the redesign did not draw again still keep one orange, «Nuovo post» (review of
// fidelity, C1 and C2): their own actions are outlined, the first setup is a quiet row
test('the pages not redrawn keep one orange', async ({ page }) => {
  const owner = await newPerson('Mara Arancio', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  const ws = await newWorkspace(page.request, org, 'Cliente Arancio')
  for (const path of [
    `/${org}`,
    `/${org}/configurazione`,
    `/${org}/impostazioni`,
    `/${org}/impostazioni/integrazioni/meta`,
    `/${org}/spazi/${ws.slug}/libreria`,
    `/${org}/spazi/${ws.slug}/membri`,
    '/account/privacy',
  ]) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    expect(await oranges(page), `elements on the orange in ${path}`).toBeLessThanOrEqual(1)
  }
  // the first setup on «Oggi»: a row on the surface, not a peach box with an orange border
  await page.goto(`/${org}`)
  const setup = page.locator('[data-first-setup]')
  await expect(setup.getByRole('link', { name: 'Riprendi la prima configurazione' })).toBeVisible()
  const look = await setup.evaluate((el) => {
    const probe = document.createElement('i')
    probe.style.color = 'var(--app-surface)'
    el.append(probe)
    const surface = getComputedStyle(probe).color
    probe.remove()
    return { background: getComputedStyle(el).backgroundColor, surface }
  })
  expect(look.background).toBe(look.surface)
})

// laptops between 1024 and 1366 (review of fidelity, A2 and A3): the week of «Oggi» keeps its
// words inside each day, «Oggi» has its two columns from a 1280 laptop (the rows fit their
// column, not the screen), and a client's name in «Clienti» is not cut to a letter
test('Oggi and Clienti on a laptop: nothing squeezed out of its place', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'computer widths only')
  const owner = await newPerson('Mara Portatile', 'owner')
  await signInWithTotp(page.request, owner)
  await newWorkspace(page.request, owner.organizationSlug, 'Panificio Lungavilla')
  for (const width of [1024, 1100, 1280, 1366]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(`/${owner.organizationSlug}`)
    await expect(page.locator('[data-ready]')).toHaveCount(1)
    const columns = await page
      .locator('[data-today-columns]')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
    expect(columns, `columns of «Oggi» at ${String(width)}`).toBe(width >= 1280 ? 2 : 1)
    const outside = await page.locator('[data-week] button').evaluateAll(
      (days) =>
        days.filter((day) => {
          const box = day.getBoundingClientRect()
          return [...day.querySelectorAll('span:not([data-accent])')].some((s) => {
            const r = s.getBoundingClientRect()
            return r.width > 0 && (r.right > box.right + 0.5 || r.bottom > box.bottom + 0.5)
          })
        }).length,
    )
    expect(outside, `days with words outside at ${String(width)}`).toBe(0)

    await page.goto(`/${owner.organizationSlug}/spazi`)
    const name = page.getByRole('link', { name: 'Panificio Lungavilla' })
    await expect(name).toBeVisible()
    // a long name may end in «…» (fonts differ between machines), never down to a letter
    expect(
      await name.evaluate((el) => el.clientWidth),
      `the name has room at ${String(width)}`,
    ).toBeGreaterThanOrEqual(120)
  }
})

// a button that cannot be pressed yet reads as off: half its colour, as `.btn[disabled]` of
// base.css, not the library's 0.75 that made «Programma» look ready (review of fidelity, A5)
test('Editor: «Programma» with nothing chosen is clearly off', async ({ page }) => {
  const owner = await newPerson('Mara Spento', 'owner')
  await signInWithTotp(page.request, owner)
  const ws = await newWorkspace(page.request, owner.organizationSlug, 'Cliente Misure')
  await page.goto(`/${owner.organizationSlug}/spazi/${ws.slug}/post/nuovo`)
  await expect(page.locator('[data-ready]')).toHaveCount(1)
  const schedule = page.locator('[data-schedule]').filter({ visible: true })
  await expect(schedule.first()).toBeDisabled()
  expect(await schedule.first().evaluate((el) => getComputedStyle(el).opacity)).toBe('0.5')
})

// what a screen reader reads of a row of the board: the platforms by name, the «…» column named
test('system board: the list reads as a table with its platforms', async ({ page }) => {
  await page.goto('/__test/sistema')
  await expect(page.locator('[data-ready]')).toHaveCount(1)
  const table = page.getByRole('table', { name: 'Post' })
  // on a phone the head and the platforms' column are hidden: the rows show two lines instead
  const phone = isPhone(page)
  await expect(table.getByRole('row')).toHaveCount(phone ? 2 : 3)
  if (phone) return
  await expect(table.getByRole('cell', { name: /Instagram.*Facebook/ }).first()).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Azioni' })).toBeAttached()
})

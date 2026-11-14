import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { newMember, signIn } from './support/people.ts'

/** The shared components of the «unione» style on their trial page (plan 04, Task 5a). */
test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await signIn(page.request, await newMember('Carla Componenti'))
  await page.goto('/__test/componenti')
  await expect(page.locator('[data-ready]')).toHaveCount(1)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768
const tableSection = (page: Page) => page.getByRole('region', { name: 'Tabella' })

async function fitsTheScreen(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

async function heights(page: Page, selector: string) {
  return page
    .locator(selector)
    .filter({ visible: true })
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
}

test('the head sums up the list with a link and keeps the main action', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Clienti' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Pizzeria Da Gino' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nuovo cliente' })).toBeVisible()
})

test('the table on a computer, rows on two levels on a phone', async ({ page }) => {
  const section = tableSection(page)
  if (isPhone(page)) {
    await expect(section.getByRole('table')).toHaveCount(0)
    const rows = section.getByRole('list', { name: 'Clienti' }).getByRole('listitem')
    await expect(rows).toHaveCount(3)
    expect(new Set(await heights(page, 'section[aria-label="Tabella"] li'))).toEqual(new Set([64]))
  } else {
    const table = section.getByRole('table', { name: 'Clienti' })
    await expect(table.getByRole('columnheader')).toHaveText([
      'Cliente',
      'Profili',
      'Collegamento',
      'Persone',
      'Azioni',
    ])
    await expect(table.getByRole('row')).toHaveCount(4)
    expect(new Set(await heights(page, 'section[aria-label="Tabella"] tbody tr'))).toEqual(
      new Set([56]),
    )
  }
  // the name is the row's link
  await expect(section.getByRole('link', { name: 'Forno Luce' })).toHaveAttribute('href', '#c1')
  // a state shows only where there is something to do, as a dot and a word
  await expect(
    section.getByText('Da ricollegare', { exact: true }).filter({ visible: true }),
  ).toBeVisible()
  await expect(section.locator('[data-tone]').filter({ visible: true })).toHaveCount(2)
  await fitsTheScreen(page)
  expect((await axe(page)).violations).toEqual([])
})

test('a list row is 56 px on a computer and 64 on a phone, with one visible action', async ({
  page,
}) => {
  const list = page.getByRole('list', { name: 'Profili' })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  const expected = isPhone(page) ? 64 : 56
  expect(new Set(await heights(page, 'ul[aria-label="Profili"] > li'))).toEqual(new Set([expected]))
  await expect(list.getByRole('button', { name: 'Ricollega' })).toBeVisible()
  await expect(list.getByRole('button', { name: 'Azioni per @fornoluce' })).toBeVisible()
})

test('«⋯» names its row and works from the keyboard', async ({ page }) => {
  const trigger = tableSection(page).getByRole('button', { name: 'Azioni per Pizzeria Da Gino' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem')).toHaveText(['Apri', 'Rinomina', 'Archivia'])
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Rinomina' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
  await expect(tableSection(page).getByText('Rinomina Pizzeria Da Gino')).toBeVisible()

  // Esc closes the menu and gives the focus back to «⋯»
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('the filter says which choice is on and the search narrows the list', async ({ page }) => {
  const section = tableSection(page)
  const filter = section.getByRole('group', { name: 'Mostra' })
  const active = filter.getByRole('button', { name: 'Attivi 3' })
  const archived = filter.getByRole('button', { name: 'Archiviati 1' })
  await expect(active).toHaveAttribute('aria-pressed', 'true')
  await expect(archived).toHaveAttribute('aria-pressed', 'false')

  await archived.click()
  await expect(archived).toHaveAttribute('aria-pressed', 'true')
  await expect(section.getByRole('link', { name: 'Cantina Monteverde' })).toBeVisible()
  await expect(section.getByRole('link', { name: 'Forno Luce' })).toHaveCount(0)
  await active.click()

  const search = section.getByRole('searchbox', { name: 'Cerca un cliente o un profilo' })
  await search.fill('gino')
  await expect(section.getByRole('link', { name: 'Pizzeria Da Gino' })).toBeVisible()
  await expect(section.getByRole('link', { name: 'Forno Luce' })).toHaveCount(0)
  // Esc empties it, and so does the cross
  await search.press('Escape')
  await expect(search).toHaveValue('')
  await expect(section.getByRole('link', { name: 'Forno Luce' })).toBeVisible()
  await search.fill('riva')
  await section.getByRole('button', { name: 'Cancella la ricerca' }).click()
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
})

test('the skeletons have the shape of the rows and announce themselves once', async ({ page }) => {
  const section = tableSection(page)
  const expected = isPhone(page) ? 64 : 56
  const rowHeights = await heights(
    page,
    isPhone(page) ? 'section[aria-label="Tabella"] li' : 'section[aria-label="Tabella"] tbody tr',
  )
  expect(new Set(rowHeights)).toEqual(new Set([expected]))

  await section.getByRole('button', { name: 'Mostra il caricamento' }).click()
  await expect(
    section.getByRole('status').filter({ hasText: 'Caricamento dei clienti' }),
  ).toHaveCount(1)
  expect(new Set(await heights(page, 'section[aria-label="Tabella"] [data-skeleton-row]'))).toEqual(
    new Set([expected]),
  )
  expect(new Set(await heights(page, 'section[aria-label="Elenco"] [data-skeleton-row]'))).toEqual(
    new Set([expected]),
  )
  await expect(page.getByRole('status').filter({ hasText: 'Caricamento dei profili' })).toHaveCount(
    1,
  )
  await fitsTheScreen(page)
  expect((await axe(page)).violations).toEqual([])
})

test('every state is a dot and a word', async ({ page }) => {
  const states = page.getByRole('region', { name: 'Stati' })
  await expect(states.locator('[data-tone]')).toHaveText([
    'Funziona',
    'Confermato',
    'Programmato',
    'Da ricollegare',
    'Con problema',
  ])
  expect((await axe(page)).violations).toEqual([])
})

import AxeBuilder from '@axe-core/playwright'
import { contrastRatio, palettes } from '@app/ui'
import type { PaletteId } from '@app/ui'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { openUserMenu } from './support/menu.ts'
import { adminQuery, newMember, signIn, signInFromPage } from './support/people.ts'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(({ baseURL }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

const isDark = async (page: Page) =>
  page.locator('html').evaluate((html) => html.classList.contains('dark'))

/** The value of an --app-* variable on the page, as written in tokens.css. */
const token = (page: Page, name: string) =>
  page
    .locator('html')
    .evaluate(
      (html, n) => getComputedStyle(html).getPropertyValue(`--app-${n}`).trim().toUpperCase(),
      name,
    )

const hex = (rgb: string) =>
  '#' +
  (rgb.match(/\d+/g) ?? [])
    .slice(0, 3)
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()

/**
 * The primary button under the pointer (hover, where the device has one) and pressed (active, on
 * phones too) takes the hover colour, and its label keeps 4.5:1 on it.
 */
async function keepsContrastWhenPointed(page: Page, button: Locator, hover: string) {
  const colours = async () =>
    button.evaluate((b) => {
      const s = getComputedStyle(b)
      return { bg: s.backgroundColor, fg: s.color }
    })
  const check = async () => {
    await expect.poll(async () => hex((await colours()).bg)).toBe(hover)
    const { bg, fg } = await colours()
    expect(contrastRatio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5)
  }
  await button.hover()
  if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) await check()
  await page.mouse.down()
  await check()
  await page.mouse.up()
}

async function fitsTheScreen(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test('a palette chosen in Impostazioni applies at once, comes back on reload, and Feedway undoes it', async ({
  page,
}) => {
  const person = await newMember()
  await signIn(page.request, person)
  await page.goto('/account')
  const colours = page.getByRole('group', { name: 'Colori' })
  await expect(colours.getByRole('radio', { name: /Feedway/ })).toBeChecked()
  await expect(page.locator('html')).not.toHaveAttribute('data-palette')
  const mode = (await isDark(page)) ? 'dark' : 'light'

  await colours.getByText('Verde', { exact: true }).click()
  await expect(colours.getByRole('radio', { name: 'Verde' })).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'verde')
  expect(await token(page, 'brand')).toBe(palettes.verde[mode].brand)
  expect(await token(page, 'bg')).toBe(palettes.verde[mode].bg)
  await expect(colours.getByRole('status')).toHaveText('Colori salvati')
  await fitsTheScreen(page)

  const saved = async () =>
    (
      await adminQuery<{ palette: string }>('select palette from users where id = $1', [
        person.userId,
      ])
    )[0]?.palette
  expect(await saved()).toBe('verde')

  // the server already writes it on <html>: the first paint has the chosen colours
  const html = await (await page.request.get('/account')).text()
  expect(html).toMatch(/<html[^>]*data-palette="verde"/)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'verde')
  await expect(
    page.getByRole('group', { name: 'Colori' }).getByRole('radio', { name: 'Verde' }),
  ).toBeChecked()

  // back to the default: no attribute, the brand kit's orange
  await page.getByRole('group', { name: 'Colori' }).getByText('Feedway', { exact: true }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-palette')
  expect(await token(page, 'brand')).toBe('#FF762E')
  await expect.poll(saved).toBe('feedway')

  // keyboard: the palettes are one group of radios
  const feedway = page
    .getByRole('group', { name: 'Colori' })
    .getByRole('radio', { name: /Feedway/ })
  await feedway.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'blu')
  await expect.poll(saved).toBe('blu')
})

/** The settings save as they change: the window of «Cambia email» has a primary button. */
async function primaryButton(page: Page) {
  await page.getByRole('button', { name: 'Cambia email' }).click()
  return page
    .getByRole('dialog', { name: 'Cambia email' })
    .getByRole('button', { name: 'Invia il link di conferma' })
}

for (const id of ['blu', 'verde', 'viola', 'grafite'] as const satisfies readonly PaletteId[]) {
  test(`${id}: the pages pass axe and the primary button keeps its contrast on hover`, async ({
    page,
  }) => {
    const person = await newMember()
    await adminQuery('update users set palette = $1 where id = $2', [id, person.userId])
    await signIn(page.request, person)

    await page.goto('/account')
    await expect(page.locator('html')).toHaveAttribute('data-palette', id)
    await expect(
      page.getByRole('group', { name: 'Colori' }).getByRole('radio', { name: new RegExp(id, 'i') }),
    ).toBeChecked()
    expect((await axe(page)).violations).toEqual([])
    await fitsTheScreen(page)

    const mode = (await isDark(page)) ? 'dark' : 'light'
    await keepsContrastWhenPointed(
      page,
      await primaryButton(page),
      palettes[id][mode]['brand-hover'],
    )

    await page.goto(`/${person.organizationSlug}/spazi`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect((await axe(page)).violations).toEqual([])
    await fitsTheScreen(page)
  })
}

test('Feedway: the orange button keeps its contrast on hover, in light and dark', async ({
  page,
}) => {
  const person = await newMember()
  await signIn(page.request, person)
  await page.goto('/account')
  await keepsContrastWhenPointed(page, await primaryButton(page), '#FF8A4C')
})

test('quick choices end on the last one, and the next person in the same browser gets their own', async ({
  page,
}) => {
  const person = await newMember('Paola Palette')
  const next = await newMember('Nino Nuovo')
  await signIn(page.request, person)
  await page.goto('/account')
  const feedway = page
    .getByRole('group', { name: 'Colori' })
    .getByRole('radio', { name: /Feedway/ })
  await feedway.focus()
  // one after the other, without waiting: the saves go in order and the last one stays
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'viola')
  await expect(page.getByRole('group', { name: 'Colori' }).getByRole('status')).toHaveText(
    'Colori salvati',
  )
  const saved = async () =>
    (
      await adminQuery<{ palette: string }>('select palette from users where id = $1', [
        person.userId,
      ])
    )[0]?.palette
  expect(await saved()).toBe('viola')

  // «Esci» from the menu, then someone else signs in without reloading the panel
  const menu = await openUserMenu(page, 'Paola Palette')
  await menu.getByRole('menuitem', { name: 'Esci' }).click()
  await expect(page).toHaveURL(/\/accedi/)
  await expect(page.locator('html')).not.toHaveAttribute('data-palette')
  await signInFromPage(page, next)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator('html')).not.toHaveAttribute('data-palette')
})

test('the error page keeps the chosen palette, opened in the panel or on its own', async ({
  page,
}) => {
  const person = await newMember('Elena Errore')
  await adminQuery('update users set palette = $1 where id = $2', ['blu', person.userId])
  await signIn(page.request, person)
  await page.goto('/account')
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'blu')
  // a link inside the panel to a page that does not exist: the router moves without a reload
  await page.waitForFunction(() => '__vue_app__' in (document.querySelector('#__nuxt') ?? {}))
  await page.evaluate(async () => {
    const root = document.querySelector('#__nuxt') as unknown as {
      __vue_app__: { config: { globalProperties: { $router: { push: (to: string) => unknown } } } }
    }
    await root.__vue_app__.config.globalProperties.$router.push('/pagina/inesistente')
  })
  await expect(page.getByRole('heading', { level: 1, name: 'Pagina non trovata' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'blu')
  // the same page loaded on its own
  await page.goto('/pagina/inesistente')
  await expect(page.getByRole('heading', { level: 1, name: 'Pagina non trovata' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'blu')
  expect((await axe(page)).violations).toEqual([])
})

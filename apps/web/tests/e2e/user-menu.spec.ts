import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  adminQuery,
  newMember,
  newPerson,
  ownAddress,
  signIn,
  signInWithTotp,
} from './support/people.ts'
import { openUserMenu } from './support/menu.ts'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

test('the user menu: who is signed in, the theme, and «Il mio account» with the sidebar', async ({
  page,
}) => {
  const owner = await newPerson('Olga Menu', 'owner')
  await signInWithTotp(page.request, owner)
  await page.goto(`/${owner.organizationSlug}`)
  // the loose «Esci» and moon are gone from the agency pages
  await expect(page.getByRole('button', { name: 'Passa al tema chiaro o scuro' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Esci', exact: true })).toHaveCount(0)

  const menu = await openUserMenu(page, 'Olga Menu')
  // who is signed in heads the menu, outside its entries
  await expect(page.getByText(owner.email)).toBeVisible()
  expect((await axe(page)).violations).toEqual([])

  // the theme changes at once, stays open, and is kept in the profile
  const html = page.locator('html')
  await menu.getByRole('menuitemradio', { name: 'Scuro' }).click()
  await expect(html).toHaveClass(/dark/)
  await expect(menu.getByRole('menuitemradio', { name: 'Scuro' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(menu).toBeVisible()
  await expect
    .poll(async () => {
      const [row] = await adminQuery<{ theme: string }>('select theme from users where id = $1', [
        owner.userId,
      ])
      return row?.theme
    })
    .toBe('dark')
  await menu.getByRole('menuitemradio', { name: 'Chiaro' }).click()
  await expect(html).not.toHaveClass(/dark/)

  // Esc closes it
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()

  // «Il mio account» keeps the agency's sidebar (or bottom bar) around it
  const again = await openUserMenu(page, 'Olga Menu')
  await again.getByRole('menuitem', { name: 'Il mio account' }).click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Il mio account' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Clienti' }).first()).toHaveAttribute(
    'href',
    `/${owner.organizationSlug}/spazi`,
  )
  expect((await axe(page)).violations).toEqual([])
})

test('the user menu works from the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a phone has no keyboard to try')
  const owner = await newPerson('Olga Tasti', 'owner')
  await signInWithTotp(page.request, owner)
  await page.goto(`/${owner.organizationSlug}`)
  const menu = await openUserMenu(page, 'Olga Tasti')
  await expect(menu.getByRole('menuitem', { name: 'Il mio account' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitemradio', { name: 'Chiaro' })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(menu.getByRole('menuitemradio', { name: 'Scuro' })).toBeFocused()
  await page.keyboard.press('End')
  await expect(menu.getByRole('menuitem', { name: 'Esci' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Il mio account' })).toBeFocused()
})

test('«Esci» from the user menu closes the session', async ({ page }) => {
  const owner = await newPerson('Olga Esce', 'owner')
  await signInWithTotp(page.request, owner)
  await page.goto(`/${owner.organizationSlug}`)
  const menu = await openUserMenu(page, 'Olga Esce')
  await menu.getByRole('menuitem', { name: 'Esci' }).click()
  await expect(page).toHaveURL(/\/accedi$/)
})

test('without an agency, «Il mio account» keeps its own header', async ({ page }) => {
  const person = await newMember('Nora Sola')
  await adminQuery('delete from organization_members where user_id = $1', [person.userId])
  await signIn(page.request, person)
  await page.goto('/account')
  await expect(page.getByRole('heading', { level: 1, name: 'Il mio account' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Esci', exact: true })).toBeVisible()
})

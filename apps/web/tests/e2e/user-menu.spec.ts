import AxeBuilder from '@axe-core/playwright'
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { withScope } from '@app/infrastructure/testing'
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
  // the first entry takes the focus, on a phone too
  await expect(menu.getByRole('menuitem', { name: 'Il mio account' })).toBeFocused()
  // who is signed in heads the menu, outside its entries
  await expect(page.getByText(owner.email)).toBeVisible()
  expect((await axe(page)).violations).toEqual([])

  // the rarely used agency pages are in the menu, not in the sidebar
  await expect(menu.getByRole('menuitem', { name: 'Registro attività' })).toHaveAttribute(
    'href',
    `/${owner.organizationSlug}/registro`,
  )
  await expect(menu.getByRole('menuitem', { name: 'Impostazioni' })).toHaveAttribute(
    'href',
    `/${owner.organizationSlug}/impostazioni`,
  )
  await expect(menu.getByRole('menuitem', { name: 'Privacy' })).toBeVisible()
  for (const name of ['Registro attività', 'Impostazioni', 'Privacy'])
    await expect(
      page
        .getByRole('navigation', { name: 'Navigazione principale' })
        .getByRole('link', { name, exact: true }),
    ).toHaveCount(0)

  // the theme is one button beside «Esci»: it changes at once, stays open, and is kept
  const html = page.locator('html')
  // the projects start in light or dark: from light, say, once in dark
  if (/\bdark\b/.test((await html.getAttribute('class')) ?? ''))
    await menu.getByRole('menuitem', { name: 'Passa al tema chiaro' }).click()
  await expect(html).not.toHaveClass(/dark/)
  await menu.getByRole('menuitem', { name: 'Passa al tema scuro' }).click()
  await expect(html).toHaveClass(/dark/)
  await expect(menu).toBeVisible()
  await expect
    .poll(async () => {
      const [row] = await adminQuery<{ theme: string }>('select theme from users where id = $1', [
        owner.userId,
      ])
      return row?.theme
    })
    .toBe('dark')
  await menu.getByRole('menuitem', { name: 'Passa al tema chiaro' }).click()
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

test('«Il mio account» keeps the agency last opened, with its context', async ({ page }) => {
  const owner = await newPerson('Olga Due Agenzie', 'owner')
  const second = randomUUID()
  await adminQuery(
    "insert into organizations (id, name, slug, status) values ($1::uuid, 'Agenzia Seconda', $1::text, 'active')",
    [second],
  )
  await adminQuery(
    "insert into organization_members (organization_id, user_id, role, status) values ($1, $2, 'owner', 'active')",
    [second, owner.userId],
  )
  await signInWithTotp(page.request, owner)
  await page.goto(`/${second}/spazi?spazio=un-cliente`)
  const menu = await openUserMenu(page, 'Olga Due Agenzie')
  await menu.getByRole('menuitem', { name: 'Il mio account' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Il mio account' })).toBeVisible()
  // the sidebar is the second agency's, and its links keep the client chosen there
  await expect(page.getByRole('link', { name: 'Clienti' }).first()).toHaveAttribute(
    'href',
    `/${second}/spazi?spazio=un-cliente`,
  )
  // «Cambia agenzia» is there with more than one agency
  const again = await openUserMenu(page, 'Olga Due Agenzie')
  await expect(again.getByRole('menuitem', { name: 'Cambia agenzia' })).toBeVisible()

  // a suspended agency is not kept: the sidebar falls back to the other one
  await withScope(process.env.E2E_DATABASE_URL ?? '', { kind: 'system' }, (c) =>
    c.query("update organizations set status = 'suspended', suspended_at = now() where id = $1", [
      second,
    ]),
  )
  await page.goto('/account')
  await expect(page.getByRole('link', { name: 'Clienti' }).first()).toHaveAttribute(
    'href',
    `/${owner.organizationSlug}/spazi`,
  )
})

test('the user menu works from the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a phone has no keyboard to try')
  const owner = await newPerson('Olga Tasti', 'owner')
  await signInWithTotp(page.request, owner)
  await page.goto(`/${owner.organizationSlug}`)
  const menu = await openUserMenu(page, 'Olga Tasti')
  await expect(menu.getByRole('menuitem', { name: 'Il mio account' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Registro attività' })).toBeFocused()
  await page.keyboard.press('End')
  await expect(menu.getByRole('menuitem', { name: /^Passa al tema/ })).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(menu.getByRole('menuitem', { name: 'Esci' })).toBeFocused()
  await page.keyboard.press('ArrowRight')
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

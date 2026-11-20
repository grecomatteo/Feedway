import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { adminQuery, newMember, newPerson, signIn, signInWithTotp } from './support/people.ts'
import { openUserMenu } from './support/menu.ts'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(({ baseURL }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

const settingsNav = (page: Page) => page.getByRole('navigation', { name: 'Impostazioni' })
const group = (page: Page, name: string) => settingsNav(page).getByRole('list', { name })
const phone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768
const MINE = ['Profilo e preferenze', 'Sicurezza', 'Dispositivi', 'Privacy']

/** The pages of «Impostazioni»: the menu on the left, on a phone the drop-down above the page. */
async function tabs(page: Page) {
  if (!phone(page)) {
    await expect(settingsNav(page).getByRole('link').first()).toBeVisible()
    return settingsNav(page).getByRole('link').allInnerTexts()
  }
  await page.locator('[data-settings-pick]').click()
  await expect(page.getByRole('menuitem').first()).toBeVisible()
  const names = await page.getByRole('menuitem').allInnerTexts()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { includeHidden: true })).toHaveCount(0)
  return names.map((n) => n.trim())
}

/** The page shown is marked: the current link, on a phone the drop-down's name. */
async function isCurrent(page: Page, name: string) {
  if (phone(page))
    await expect(page.locator('[data-settings-pick]')).toHaveAccessibleName(
      `Pagina delle impostazioni: ${name}`,
    )
  else
    await expect(settingsNav(page).getByRole('link', { name, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
}

async function openTab(page: Page, name: string) {
  if (phone(page)) {
    await page.locator('[data-settings-pick]').click()
    await page.getByRole('menuitem', { name, exact: true }).click()
  } else await settingsNav(page).getByRole('link', { name, exact: true }).click()
}

/** The page fits the screen: nothing scrolls sideways, on a phone too. */
async function fitsTheScreen(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test('an Owner opens «Impostazioni» from the user menu and finds both groups', async ({ page }) => {
  const owner = await newPerson('Olga Impostazioni Uniche', 'owner')
  await signInWithTotp(page.request, owner)
  await page.goto(`/${owner.organizationSlug}`)

  const menu = await openUserMenu(page, 'Olga Impostazioni Uniche')
  // one entry for every setting: «Il mio account» is gone
  await expect(menu.getByRole('menuitem', { name: 'Il mio account' })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Impostazioni' })).toHaveCount(1)
  await menu.getByRole('menuitem', { name: 'Impostazioni' }).click()

  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeVisible()
  // the person's pages, then the agency's: Integrazioni, and the activity log among them; the
  // agency's privacy notice is under the person's «Privacy» (screen 23)
  expect(await tabs(page)).toEqual([...MINE, 'Generali', 'Integrazioni', 'Registro attività'])
  await isCurrent(page, 'Profilo e preferenze')
  if (!phone(page)) {
    // on a computer the agency's group takes its name
    await expect(group(page, 'Il tuo account').getByRole('link')).toHaveCount(4)
    await expect(group(page, 'Agenzia').getByRole('link', { name: 'Generali' })).toHaveAttribute(
      'href',
      `/${owner.organizationSlug}/impostazioni`,
    )
  }
  await fitsTheScreen(page)
  expect((await axe(page)).violations).toEqual([])

  // the agency's tabs live in the same shell, at their own address
  await openTab(page, 'Integrazioni')
  await expect(page).toHaveURL(new RegExp(`/${owner.organizationSlug}/impostazioni/integrazioni$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeVisible()
  await isCurrent(page, 'Integrazioni')
  expect(await tabs(page)).toHaveLength(7)
  await fitsTheScreen(page)
  expect((await axe(page)).violations).toEqual([])
})

test('on a wide screen the settings start next to the sidebar, with no gap', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) < 768, 'the sidebar is on a computer')
  await page.setViewportSize({ width: 1920, height: 1000 })
  const owner = await newPerson('Olga Impostazioni Larghe', 'owner')
  await signInWithTotp(page.request, owner)
  await page.goto(`/${owner.organizationSlug}/impostazioni`)
  await expect(page.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeVisible()
  // prova 0.10.0, R-12: a centred page left some 340 px empty between the two menus
  const sidebar = await page
    .getByRole('navigation', { name: 'Navigazione principale' })
    .boundingBox()
  const menu = await settingsNav(page).boundingBox()
  if (!sidebar || !menu) throw new Error('menus not on screen')
  expect(menu.x - (sidebar.x + sidebar.width)).toBeLessThan(64)
})

test('a Member sees «Il tuo account», the agency’s privacy notice under «Privacy»', async ({
  page,
}) => {
  const member = await newMember('Mara Impostazioni')
  await signIn(page.request, member)
  await page.goto('/account')
  await expect(page.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeVisible()
  // nothing of the agency to set: only the person's pages
  expect(await tabs(page)).toEqual(MINE)
  await openTab(page, 'Privacy')
  await expect(page.getByRole('heading', { level: 2, name: /^Informativa di / })).toBeVisible()

  const menu = await openUserMenu(page, 'Mara Impostazioni')
  await expect(menu.getByRole('menuitem', { name: 'Impostazioni' })).toHaveAttribute(
    'href',
    '/account',
  )
})

test('without an agency, «Impostazioni» has only «Il tuo account»', async ({ page }) => {
  const person = await newMember('Nora Impostazioni')
  await adminQuery('delete from organization_members where user_id = $1', [person.userId])
  await signIn(page.request, person)
  await page.goto('/account')
  await expect(page.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeVisible()
  expect(await tabs(page)).toEqual(MINE)
  await fitsTheScreen(page)
  expect((await axe(page)).violations).toEqual([])
})

test('a link from an email to /account/sicurezza opens that tab inside the shell', async ({
  page,
}) => {
  const member = await newMember('Ugo Link Email')
  await signIn(page.request, member)
  await page.goto('/account/sicurezza')
  await expect(page.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeVisible()
  await isCurrent(page, 'Sicurezza')
  await expect(page.getByRole('heading', { level: 2, name: 'Accesso' })).toBeVisible()
  await fitsTheScreen(page)
  expect((await axe(page)).violations).toEqual([])
})

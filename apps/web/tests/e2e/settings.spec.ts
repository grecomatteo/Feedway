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
  const mine = group(page, 'Il tuo account')
  await expect(mine.getByRole('link')).toHaveText([
    'Profilo e preferenze',
    'Sicurezza',
    'Dispositivi',
    'Privacy',
  ])
  await expect(mine.getByRole('link', { name: 'Profilo e preferenze' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  const agency = group(page, 'Agenzia')
  await expect(agency.getByRole('link')).toHaveText(['Generali', 'Integrazioni'])
  await expect(agency.getByRole('link', { name: 'Generali' })).toHaveAttribute(
    'href',
    `/${owner.organizationSlug}/impostazioni`,
  )
  await fitsTheScreen(page)
  expect((await axe(page)).violations).toEqual([])

  // the agency's tabs live in the same shell, at their own address
  await agency.getByRole('link', { name: 'Integrazioni' }).click()
  await expect(page).toHaveURL(new RegExp(`/${owner.organizationSlug}/impostazioni/integrazioni$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeVisible()
  await expect(group(page, 'Agenzia').getByRole('link', { name: 'Integrazioni' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(group(page, 'Il tuo account').getByRole('link')).toHaveCount(4)
  await fitsTheScreen(page)
  expect((await axe(page)).violations).toEqual([])
})

test('a Member sees only «Il tuo account»', async ({ page }) => {
  const member = await newMember('Mara Impostazioni')
  await signIn(page.request, member)
  await page.goto('/account')
  await expect(page.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeVisible()
  await expect(group(page, 'Il tuo account').getByRole('link')).toHaveCount(4)
  await expect(group(page, 'Agenzia')).toHaveCount(0)

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
  await expect(group(page, 'Il tuo account').getByRole('link')).toHaveCount(4)
  await expect(group(page, 'Agenzia')).toHaveCount(0)
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
  await expect(
    group(page, 'Il tuo account').getByRole('link', { name: 'Sicurezza' }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { level: 2, name: 'Password' })).toBeVisible()
  await fitsTheScreen(page)
  expect((await axe(page)).violations).toEqual([])
})

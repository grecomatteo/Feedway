import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { newWorkspace } from './support/meta.ts'
import { addPerson, newPerson, ownAddress, signIn, signInWithTotp } from './support/people.ts'

// The agency's menu and the phone (plan 04 Task 6b, spec §11.11): no «Account social», the bar
// at the bottom Home · Calendario · + · Clienti · Tu, and the «Tu» menu with the person's pages.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Navigazione principale' })
const youMenu = (page: Page) => page.getByRole('menu', { name: 'Il tuo account' })

/** An Owner with the second factor and one client; signed in. */
async function ownerWithClient(page: Page, name: string) {
  const owner = await newPerson(name, 'owner')
  await signInWithTotp(page.request, owner)
  const client = await newWorkspace(page.request, owner.organizationSlug, 'Cliente Barra')
  return { owner, org: owner.organizationSlug, client }
}

test('every agency page has the menu, and «Account social» is not in it', async ({
  page,
  isMobile,
}) => {
  const { org, client } = await ownerWithClient(page, 'Olga Barra')
  for (const path of [
    `/${org}`,
    `/${org}/spazi`,
    `/${org}/spazi/${client.slug}`,
    `/${org}/spazi/${client.slug}/membri`,
    `/${org}/spazi/${client.slug}/libreria`,
    `/${org}/media`,
    `/${org}/utenti`,
    `/${org}/registro`,
    `/${org}/privacy`,
    `/${org}/impostazioni`,
    `/${org}/impostazioni/integrazioni`,
    `/${org}/impostazioni/integrazioni/meta`,
    `/${org}/impostazioni/integrazioni/meta/aggiungi`,
    '/account',
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 }).first(), path).toBeVisible()
    const nav = mainNav(page)
    await expect(nav, path).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Clienti' }), path).toBeVisible()
    await expect(nav.locator(`a[href^="/${org}/account"]`), path).toHaveCount(0)
    await expect(nav.getByText('Account social'), path).toHaveCount(0)
  }
  if (!isMobile) {
    // the sidebar: Home, Clienti, Media, Utenti, nothing else
    await page.goto(`/${org}`)
    await expect(mainNav(page).getByRole('link')).toHaveText(['Home', 'Clienti', 'Media', 'Utenti'])
  }
})

test('the bar at the bottom: five places, Calendario and + not there yet, the bell above', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'the bar at the bottom is the phone')
  const { org } = await ownerWithClient(page, 'Olga Telefono')
  await page.goto(`/${org}/spazi`)
  const nav = mainNav(page)
  await expect(nav.getByRole('listitem')).toHaveCount(5)
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('href', `/${org}`)
  await expect(nav.getByRole('link', { name: 'Clienti' })).toHaveAttribute('aria-current', 'page')
  for (const name of ['Calendario (Presto)', 'Nuovo post (Presto)'])
    await expect(nav.getByRole('link', { name })).toHaveAttribute('aria-disabled', 'true')
  await expect(nav.getByRole('button', { name: /^Tu, menu di Olga Telefono/ })).toBeVisible()
  // the photo at the top is gone: the person's menu opens only from «Tu»
  await expect(page.getByRole('button', { name: /menu di/i })).toHaveCount(1)
  // the notifications live in the bell at the top, until the centre exists (stage 8)
  const bell = page.getByRole('banner').getByRole('button', { name: 'Notifiche (Presto)' })
  await expect(bell).toBeVisible()
  await expect(bell).toBeDisabled()
  expect((await axe(page)).violations).toEqual([])

  // a Viewer creates no posts: four places, no +
  const viewer = await addPerson(org, 'Vera Viewer', 'member', [
    { workspaceId: (await newWorkspace(page.request, org, 'Cliente Vista')).id, role: 'viewer' },
  ])
  await page.context().clearCookies()
  await signIn(page.request, viewer)
  await page.goto(`/${org}`)
  await expect(
    mainNav(page).getByRole('button', { name: /^Tu, menu di Vera Viewer/ }),
  ).toBeVisible()
  await expect(mainNav(page).getByRole('listitem')).toHaveCount(4)
  await expect(mainNav(page).getByRole('link', { name: /Nuovo post/ })).toHaveCount(0)
  expect((await axe(page)).violations).toEqual([])
})

test('the «Tu» menu: the person’s pages by role, and the keyboard opens and closes it', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'the «Tu» menu is the phone')
  const { org, client } = await ownerWithClient(page, 'Olga Tu')
  await page.goto(`/${org}`)
  const you = mainNav(page).getByRole('button', { name: /^Tu, menu di Olga Tu/ })
  // a click before the page runs in the browser would be lost
  await expect(you).toBeEnabled()
  await you.focus()
  await page.keyboard.press('Enter')
  const menu = youMenu(page)
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Utenti' })).toBeFocused()
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Utenti',
    'Impostazioni',
    'Registro attività',
    'Privacy',
    'Esci',
    '',
  ])
  await expect(menu.getByRole('menuitem', { name: 'Utenti' })).toHaveAttribute(
    'href',
    `/${org}/utenti`,
  )
  await expect(menu.locator(`a[href^="/${org}/account"]`)).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: /^Passa al tema/ })).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(you).toBeFocused()

  // a Publisher: no Utenti, no Registro attività
  const publisher = await addPerson(org, 'Paolo Publisher', 'member', [
    { workspaceId: client.id, role: 'publisher' },
  ])
  await page.context().clearCookies()
  await signIn(page.request, publisher)
  await page.goto(`/${org}`)
  await expect(mainNav(page).getByRole('listitem')).toHaveCount(5)
  const their = mainNav(page).getByRole('button', { name: /^Tu, menu di Paolo Publisher/ })
  await expect(their).toBeEnabled()
  await their.click()
  await expect(youMenu(page).getByRole('menuitem')).toHaveText([
    'Impostazioni',
    'Privacy',
    'Esci',
    '',
  ])
})

test('on a computer the user menu keeps Utenti in the sidebar, not in the menu', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'the sidebar is the computer')
  const { org } = await ownerWithClient(page, 'Olga Laterale')
  await page.goto(`/${org}`)
  await expect(page.getByRole('button', { name: 'Notifiche (Presto)' })).toHaveCount(0)
  const trigger = page.getByRole('button', { name: /Olga Laterale/ })
  await expect(trigger).toBeEnabled()
  await trigger.click()
  const menu = youMenu(page)
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Utenti' })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Registro attività' })).toBeVisible()
  await expect(menu.locator(`a[href^="/${org}/account"]`)).toHaveCount(0)
})

test('the old addresses of the accounts land in Integrazioni → Meta, keeping the client', async ({
  page,
}) => {
  const { org, client } = await ownerWithClient(page, 'Olga Integrazioni')
  await page.goto(`/${org}/account?spazio=${client.slug}`)
  await expect(page).toHaveURL(
    new RegExp(`/${org}/impostazioni/integrazioni/meta\\?spazio=${client.slug}$`),
  )
  await expect(page.getByRole('heading', { name: 'Meta', level: 2 })).toBeVisible()
  await page.goto(`/${org}/account/aggiungi`)
  await expect(page).toHaveURL(new RegExp(`/${org}/impostazioni/integrazioni/meta/aggiungi$`))
  await expect(page.getByRole('heading', { name: 'Aggiungi account', level: 2 })).toBeVisible()
  // no bridge left in Integrazioni: the entry of the platform
  await page.goto(`/${org}/impostazioni/integrazioni`)
  await expect(page.getByRole('link', { name: 'Apri gli account collegati' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Meta/ })).toHaveAttribute(
    'href',
    `/${org}/impostazioni/integrazioni/meta`,
  )

  // who does not manage the connections lands in Clienti
  const member = await addPerson(org, 'Mara Member', 'member', [
    { workspaceId: client.id, role: 'publisher' },
  ])
  await page.context().clearCookies()
  await signIn(page.request, member)
  await page.goto(`/${org}/account`)
  await expect(page).toHaveURL(new RegExp(`/${org}/spazi$`))
  await page.goto(`/${org}/account/aggiungi`)
  await expect(page).toHaveURL(new RegExp(`/${org}/spazi$`))
})

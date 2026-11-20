import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { assignAccount, connectedAgency, newWorkspace } from './support/meta.ts'
import {
  addPerson,
  adminQuery,
  newPerson,
  ownAddress,
  signIn,
  signInWithTotp,
} from './support/people.ts'

// The agency's shell (D-81, Task R2 of the redesign; spec §11.11): the sidebar with «Nuovo post»,
// the bar at the bottom Oggi · Calendario · + · Clienti · Tu, the «Tu» menu with the person's
// pages, and the client selector with its search.

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
    `/${org}/libreria`,
    `/${org}/utenti`,
    `/${org}/impostazioni/registro`,
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
    // the sidebar (screen 02): Oggi, Calendario (off), Clienti, Libreria; under the agency's
    // name Utenti and Impostazioni
    await page.goto(`/${org}`)
    await expect(mainNav(page).getByRole('link')).toHaveText([
      'Oggi',
      /^Calendario/,
      'Clienti',
      'Libreria',
      'Utenti',
      'Impostazioni',
    ])
    await expect(mainNav(page).getByRole('link', { name: 'Calendario (Presto)' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(mainNav(page).getByRole('link', { name: 'Oggi' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await page.goto(`/${org}/impostazioni/registro`)
    await expect(mainNav(page).getByRole('link', { name: 'Impostazioni' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  }
})

test('the bar at the bottom: five places, Calendario not there yet, + for a new post, the bell above', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'the bar at the bottom is the phone')
  const { org } = await ownerWithClient(page, 'Olga Telefono')
  await page.goto(`/${org}/spazi`)
  const nav = mainNav(page)
  await expect(nav.getByRole('listitem')).toHaveCount(5)
  await expect(nav.getByRole('link', { name: 'Oggi' })).toHaveAttribute('href', `/${org}`)
  await expect(nav.getByRole('link', { name: 'Clienti' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: 'Calendario (Presto)' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  // in «Tutti i clienti» the + asks the client first; with only one it goes to its editor
  await nav.getByRole('link', { name: 'Nuovo post' }).click()
  await expect(page).toHaveURL(new RegExp(`/${org}/spazi/[^/]+/post/nuovo`))
  await page.goto(`/${org}/spazi`)
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
  await expect(menu.getByRole('menuitem', { name: 'Libreria' })).toBeFocused()
  // screen 06: the activity log and the privacy notice are reached from Impostazioni
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Libreria',
    'Utenti',
    'Impostazioni',
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

  // a Publisher: no Utenti
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
    'Libreria',
    'Impostazioni',
    'Esci',
    '',
  ])
})

test('on a computer: the bell beside the logo, «Nuovo post», and the menu of screen 06', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'the sidebar is the computer')
  const { org, client } = await ownerWithClient(page, 'Olga Laterale')
  await page.goto(`/${org}`)
  const sidebar = page.getByRole('complementary')
  expect((await sidebar.boundingBox())?.width).toBe(240)
  // the notifications live in the bell, until the centre exists (stage 8)
  const bell = sidebar.getByRole('button', { name: 'Notifiche (Presto)' })
  await expect(bell).toBeVisible()
  await expect(bell).toBeDisabled()
  // «Nuovo post» is always there: in «Tutti i clienti» it asks the client first, in a client's
  // context it opens that client's editor
  const newPost = sidebar.getByRole('link', { name: 'Nuovo post' })
  await expect(newPost).toHaveAttribute('href', `/${org}/post/nuovo`)
  await page.goto(`/${org}/spazi/${client.slug}`)
  await expect(newPost).toHaveAttribute('href', `/${org}/spazi/${client.slug}/post/nuovo`)

  const trigger = page.getByRole('button', { name: /Olga Laterale/ })
  await expect(trigger).toBeEnabled()
  // the person's row: name and role, nothing else
  await expect(trigger).toHaveText('OLOlga LateraleOwner')
  await trigger.click()
  const menu = youMenu(page)
  await expect(menu).toBeVisible()
  // Libreria and Utenti are in the side bar already: the menu does not repeat them (D-87.1)
  await expect(menu.getByRole('menuitem')).toHaveText(['Impostazioni', 'Esci', ''])
  await expect(menu.locator(`a[href^="/${org}/account"]`)).toHaveCount(0)
  expect((await axe(page)).violations).toEqual([])
})

test('the client selector: search, a dot on a client to fix, «Nuovo cliente», and the keyboard', async ({
  page,
  isMobile,
}) => {
  const { org, client } = await ownerWithClient(page, 'Olga Selettore')
  const other = await newWorkspace(page.request, org, 'Osteria Bruna')
  // a profile of Cliente Barra whose Page stopped working: the dot of screen 04
  await connectedAgency(page.request, org)
  const [page1] = await adminQuery<{ id: string }>(
    "select id from social_accounts where organization_id = $1 and platform = 'facebook' limit 1",
    [org],
  )
  await assignAccount(page.request, org, client.id, page1?.id ?? '')
  await adminQuery("update social_accounts set health = 'error' where id = $1", [page1?.id])
  await page.goto(`/${org}/spazi`)
  const trigger = page.getByRole('button', { name: /^Contesto:/ }).locator('visible=true')
  await expect(trigger).toBeEnabled()
  await expect(trigger).toContainText('Tutti i clienti')
  await trigger.click()
  const search = page.getByRole('combobox', { name: 'Cerca un cliente' })
  await expect(search).toBeVisible()
  const list = page.getByRole('listbox', { name: 'Contesto' })
  // the initials of each square come first in the text
  await expect(list.getByRole('option')).toHaveText([
    /Tutti i clienti$/,
    /Cliente Barra, un profilo con un problema$/,
    /Osteria Bruna$/,
  ])
  await expect(list.getByRole('option', { name: 'Tutti i clienti' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(list.locator('[data-problem="error"]')).toHaveCount(1)
  expect((await axe(page)).violations).toEqual([])

  // the search narrows the list, accents and case aside; Enter picks the first client found
  if (isMobile) await search.click()
  else await expect(search).toBeFocused()
  await search.fill('ostèria')
  await expect(list.getByRole('option')).toHaveText([/Tutti i clienti$/, /Osteria Bruna$/])
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/${org}/spazi/${other.slug}$`))
  await expect(trigger).toContainText('Osteria Bruna')

  // the arrows walk the list, Esc closes it and gives the focus back
  await trigger.click()
  await expect(list.getByRole('option', { name: 'Osteria Bruna' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await search.press('ArrowUp')
  await expect(search).toHaveAttribute(
    'aria-activedescendant',
    (await list.getByRole('option', { name: /^Cliente Barra/ }).getAttribute('id')) ?? '',
  )
  await search.press('Escape')
  await expect(list).toBeHidden()
  await expect(trigger).toBeFocused()

  // «Nuovo cliente» opens the dialog of the clients' page
  await trigger.click()
  await page.getByRole('link', { name: 'Nuovo cliente' }).click()
  await expect(page.getByRole('dialog', { name: 'Nuovo cliente' })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/${org}/spazi$`))
})

test('the old addresses of the accounts land in Integrazioni → Meta, keeping the client', async ({
  page,
}) => {
  const { org, client } = await ownerWithClient(page, 'Olga Integrazioni')
  await page.goto(`/${org}/account?spazio=${client.slug}`)
  await expect(page).toHaveURL(
    new RegExp(`/${org}/impostazioni/integrazioni/meta\\?spazio=${client.slug}$`),
  )
  await expect(page.getByRole('heading', { name: 'Meta', exact: true, level: 2 })).toBeVisible()
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

test('the measures of the shell (base.css): 240 and 44 on a computer, one row at the top on a phone', async ({
  page,
  isMobile,
}) => {
  const { org } = await ownerWithClient(page, 'Olga Misure')
  await page.goto(`/${org}/spazi`)
  const height = async (locator: ReturnType<Page['locator']>) =>
    Math.round((await locator.boundingBox())?.height ?? 0)
  const trigger = page.getByRole('button', { name: /^Contesto:/ }).locator('visible=true')
  await expect(trigger).toBeVisible()
  if (!isMobile) {
    const sidebar = page.getByRole('complementary')
    expect(Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(240)
    expect(await height(trigger)).toBe(44)
    expect(await height(sidebar.getByRole('link', { name: 'Nuovo post' }))).toBe(36)
    expect(await height(mainNav(page).getByRole('link', { name: 'Clienti' }))).toBe(36)
    // the title starts 28 below the top and 32 from the sidebar
    const title = await page.getByRole('heading', { level: 1 }).first().boundingBox()
    expect(Math.round(title?.x ?? 0)).toBe(240 + 32)
    return
  }
  // one row at the top: the selector and the bell, no agency row and no sidebar
  const top = page.getByRole('banner')
  await expect(top).toHaveCount(1)
  expect(await height(top)).toBe(52)
  await expect(top.getByRole('button')).toHaveCount(2)
  expect(await height(trigger)).toBe(40)
  expect(await height(top.getByRole('button', { name: 'Notifiche (Presto)' }))).toBe(44)
  await expect(page.getByRole('complementary')).toBeHidden()
  expect(await height(mainNav(page))).toBe(60)
  expect(
    await height(mainNav(page).getByRole('link', { name: 'Nuovo post' }).locator('span').first()),
  ).toBe(36)
})

// the personal settings keep the shell of the agency's pages (screens 23 and 24): the selector
// on «Tutti i clienti», so nothing moves and the phone's row is not empty (review of fidelity, A6)
test('the personal settings keep the client selector, and a client leads to its page', async ({
  page,
}) => {
  const { org, client } = await ownerWithClient(page, 'Olga Profilo')
  await page.goto(`/${org}/spazi`)
  const trigger = page.getByRole('button', { name: /^Contesto:/ }).locator('visible=true')
  const before = await trigger.boundingBox()
  await page.goto('/account')
  await expect(trigger).toHaveAccessibleName(/Tutti i clienti/)
  await expect(trigger).toBeEnabled()
  expect((await trigger.boundingBox())?.y).toBe(before?.y)
  await trigger.click()
  await page.getByRole('option', { name: /Cliente Barra/ }).click()
  await expect(page).toHaveURL(new RegExp(`/${org}/spazi/${client.slug}$`))
})

test('a search that finds nobody: Enter picks nothing', async ({ page }) => {
  const { org, client } = await ownerWithClient(page, 'Olga Ricerca')
  await page.goto(`/${org}/spazi/${client.slug}`)
  const trigger = page.getByRole('button', { name: /^Contesto:/ }).locator('visible=true')
  await expect(trigger).toBeEnabled()
  await trigger.click()
  const search = page.getByRole('combobox', { name: 'Cerca un cliente' })
  await search.fill('nessuno così')
  await expect(page.getByText('Nessun cliente con questo nome')).toBeVisible()
  await search.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/${org}/spazi/${client.slug}$`))
})

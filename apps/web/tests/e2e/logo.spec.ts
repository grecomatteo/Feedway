import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { transparentLogoPng } from '@app/infrastructure/testing'
import {
  E2E_PASSWORD,
  addPerson,
  newPerson,
  ownAddress,
  signIn,
  signInWithTotp,
} from './support/people.ts'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

/**
 * The logo once it has loaded: the small one of the sidebar on a computer; on a phone, with a
 * single agency, the top bar shows no agency, so the large one of the settings.
 */
async function shownLogo(page: Page, org: string) {
  const size = phone(page) ? 256 : 64
  const logo = page
    .locator(`img[src^="/api/v1/orgs/${org}/logo/${String(size)}?v="]`)
    .locator('visible=true')
  await expect(logo).toBeVisible()
  await expect
    .poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(size)
  return logo
}

const phone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768

test('the Owner uploads the logo and sees it in the sidebar, whole', async ({
  page,
  browser,
  baseURL,
}) => {
  const owner = await newPerson('Olga Logo', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await page.goto(`/${org}/impostazioni`)
  const section = page.getByRole('region', { name: "Logo dell'agenzia" })
  await expect(section.getByRole('button', { name: 'Scegli il logo' })).toBeEnabled()
  expect((await axe(page)).violations).toEqual([])

  await section.getByTestId('logo-file').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: await transparentLogoPng(600, 200),
  })
  // a change of the agency: the Owner confirms it is them first
  const reauth = page.getByRole('dialog', { name: 'Conferma che sei tu' })
  await reauth.getByLabel('Password').fill(E2E_PASSWORD)
  await reauth.getByRole('button', { name: 'Conferma' }).click()
  // its closing animation would overlap the next dialog's check
  await expect(
    page.getByRole('dialog', { name: 'Conferma che sei tu', includeHidden: true }),
  ).toHaveCount(0)
  const dialog = page.getByRole('dialog', { name: 'Controlla il logo' })
  await expect(dialog).toBeVisible()
  // never cropped: no crop area, the preview shows it whole
  await expect(dialog.getByRole('slider')).toHaveCount(0)
  await expect(dialog.getByTestId('logo-preview-large')).toBeVisible()
  const dialogAxe = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(dialogAxe.violations).toEqual([])

  await dialog.getByRole('button', { name: 'Usa questo logo' }).click()
  await expect(dialog).toBeHidden()
  await expect(section.getByRole('status')).toHaveText('Logo salvato: ora è nella barra.')
  const logo = await shownLogo(page, org)
  await expect(logo).toHaveCSS('object-fit', 'contain')

  // a member of the agency sees it too, in the sidebar of a computer
  if (!phone(page)) await memberSees(org, browser, baseURL ?? '')

  // back to the initials
  await section.getByRole('button', { name: 'Togli il logo' }).click()
  await expect(section.getByRole('status')).toHaveText(
    "Logo tolto: ora si vedono le iniziali dell'agenzia.",
  )
  await expect(page.locator(`img[src^="/api/v1/orgs/${org}/logo/"]`)).toHaveCount(0)
})

async function memberSees(org: string, browser: Browser, baseURL: string) {
  const member = await addPerson(org, 'Mario Logo', 'member')
  const other = await browser.newContext({ baseURL })
  try {
    const page = await other.newPage()
    await ownAddress(page)
    await signIn(page.request, member)
    await page.goto(`/${org}`)
    await shownLogo(page, org)
  } finally {
    await other.close()
  }
}

test('an Admin sees no logo section, only the settings to read', async ({ page }) => {
  const admin = await newPerson('Ada Logo', 'admin')
  await signInWithTotp(page.request, admin)
  await page.goto(`/${admin.organizationSlug}/impostazioni`)
  await expect(page.getByText("Solo l'Owner può cambiarle.")).toBeVisible()
  await expect(page.getByRole('region', { name: "Logo dell'agenzia" })).toHaveCount(0)
})

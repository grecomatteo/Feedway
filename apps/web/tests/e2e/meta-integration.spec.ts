import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { META_MOCK } from '@app/meta-mock'
import {
  E2E_PASSWORD,
  addDataKey,
  addPerson,
  adminQuery,
  newPerson,
  ownAddress,
  signInWithTotp,
} from './support/people.ts'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

async function confirmWithPassword(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Conferma che sei tu' })
  await dialog.getByLabel('Password').fill(E2E_PASSWORD)
  await dialog.getByRole('button', { name: 'Conferma' }).click()
}

test('meta integration: the owner saves and tries the app, the admin only reads it', async ({
  page,
  browser,
  baseURL,
}) => {
  const owner = await newPerson('Olga Meta', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await addDataKey(org)
  await page.goto(`/${org}/impostazioni`)
  // the menu on the left, on a phone the drop-down above the page
  const phone = (page.viewportSize()?.width ?? 1280) < 768
  const pick = page.locator('[data-settings-pick]')
  if (phone) {
    await pick.click()
    await page.getByRole('menuitem', { name: 'Integrazioni' }).click()
  } else
    await page
      .getByRole('navigation', { name: 'Impostazioni' })
      .getByRole('link', { name: 'Integrazioni' })
      .click()
  // one entry per platform: Meta, not set up yet
  const entry = page.getByRole('list', { name: 'Integrazioni' }).getByRole('link', { name: /Meta/ })
  await expect(entry.getByTestId('meta-entry-state')).toHaveText('Da configurare')
  expect((await axe(page)).violations).toEqual([])
  await entry.click()
  await expect(page).toHaveURL(new RegExp(`/${org}/impostazioni/integrazioni/meta$`))
  await expect(page.getByRole('heading', { name: 'Meta', exact: true })).toBeVisible()
  // Integrazioni → Meta is still the Integrazioni tab
  if (phone) await expect(pick).toHaveAccessibleName('Pagina delle impostazioni: Integrazioni')
  else
    await expect(
      page
        .getByRole('navigation', { name: 'Impostazioni' })
        .getByRole('link', { name: 'Integrazioni' }),
    ).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('meta-integration-state')).toHaveText('Da configurare')
  await expect(page.getByText('Meta li aggiunge da solo')).toBeVisible()
  expect((await axe(page)).violations).toEqual([])

  // a secret Meta refuses is not saved
  await page.getByLabel('App ID').fill(META_MOCK.app.id)
  await page.getByLabel('App Secret').fill('non-e-il-secret')
  await page.getByRole('button', { name: 'Salva e verifica' }).click()
  await confirmWithPassword(page)
  await expect(page.getByText('Meta non accetta questo App ID con questo App Secret')).toBeVisible()
  await expect(page.getByTestId('meta-integration-state')).toHaveText('Da configurare')

  await page.getByLabel('App Secret').fill(META_MOCK.app.secret)
  const checkup = page.getByRole('button', { name: /^Scadenza del Data Use Checkup:/ })
  await checkup.click()
  // a month ahead, from the keyboard
  await page.keyboard.press('PageDown')
  await page.keyboard.press('Enter')
  await expect(checkup).not.toHaveAccessibleName(/Scegli il giorno/)
  await page.getByRole('button', { name: 'Salva e verifica' }).click()
  // the form gives way to the rows of screen 25
  const app = page.getByRole('region', { name: 'App Meta' })
  await expect(app.getByRole('status')).toHaveText('Impostazioni di Meta salvate.')
  await expect(page.getByTestId('meta-integration-state')).toHaveText('Funziona')
  await expect(app).toContainText(META_MOCK.app.id)
  await expect(app.getByText('Scadenza del Data Use Checkup')).toBeVisible()
  // the secret never comes back
  const edit = page.getByRole('dialog', { name: "Modifica l'app Meta" })
  await app.getByRole('button', { name: "Modifica l'app Meta" }).click()
  await expect(edit.getByLabel('App Secret')).toHaveValue('')

  await edit.getByRole('button', { name: 'Prova' }).click()
  await expect(edit.getByRole('status')).toHaveText('Funziona: Meta accetta App ID e App Secret.')
  expect((await axe(page)).violations).toEqual([])
  await page.keyboard.press('Escape')
  await expect(edit).toBeHidden()

  // a job's call was refused by Meta (the secret was reset there): red here and in the reminders
  await adminQuery(
    `update integrations set verified_at = null, rejected_at = now()
       where kind = 'meta' and organization_id = (select id from organizations where slug = $1)`,
    [org],
  )
  await page.reload()
  await expect(page.getByTestId('meta-integration-state')).toHaveText('Non funziona')
  await expect(page.getByText("Meta l'ha rifiutata il")).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
  await page.goto(`/${org}/impostazioni/integrazioni`)
  await expect(page.getByTestId('meta-entry-state')).toHaveText('Non funziona')
  await page.goto(`/${org}/impostazioni/integrazioni/meta`)
  await expect(page.getByRole('region', { name: 'Da sistemare su Meta' })).toContainText(
    "Meta non accetta più l'App ID o l'App Secret dell'agenzia",
  )
  // a test that works takes it away, and keeps what was typed and not saved yet
  await page.getByRole('button', { name: "Modifica l'app Meta" }).click()
  await edit.getByLabel('App Secret').fill('incollato-non-salvato')
  await edit.getByRole('button', { name: 'Prova' }).click()
  await expect(edit.getByRole('status')).toHaveText('Funziona: Meta accetta App ID e App Secret.')
  await expect(page.getByTestId('meta-integration-state')).toHaveText('Funziona')
  await expect(edit.getByLabel('App Secret')).toHaveValue('incollato-non-salvato')
  await page.reload()
  await expect(page.getByTestId('meta-integration-state')).toHaveText('Funziona')
  await expect(page.getByText("Meta non accetta più l'App ID")).toHaveCount(0)

  const admin = await addPerson(org, 'Ada Admin', 'admin')
  const context = await browser.newContext({ baseURL: baseURL ?? '' })
  const adminPage = await context.newPage()
  await ownAddress(adminPage)
  await signInWithTotp(adminPage.request, admin)
  await adminPage.goto(`/${org}/impostazioni/integrazioni/meta`)
  // the Admin reads the rows and changes nothing
  await expect(adminPage.getByRole('region', { name: 'App Meta' })).toContainText(META_MOCK.app.id)
  await expect(adminPage.getByRole('button', { name: "Modifica l'app Meta" })).toHaveCount(0)
  await expect(adminPage.getByLabel('App ID')).toHaveCount(0)
  await expect(adminPage.getByRole('button', { name: 'Salva e verifica' })).toHaveCount(0)
  await expect(adminPage.getByRole('button', { name: 'Prova' })).toHaveCount(0)
  expect((await axe(adminPage)).violations).toEqual([])
  await context.close()
})

test('meta integration: an admin sees that the owner has not set it up yet', async ({ page }) => {
  const admin = await newPerson('Ada Senza Meta', 'admin')
  await signInWithTotp(page.request, admin)
  await page.goto(`/${admin.organizationSlug}/impostazioni/integrazioni/meta`)
  await expect(page.getByText("L'app Meta non è ancora configurata")).toBeVisible()
  await expect(page.getByLabel('App ID')).toHaveCount(0)
  expect((await axe(page)).violations).toEqual([])
})

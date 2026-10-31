import AxeBuilder from '@axe-core/playwright'
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { secretOf, totpCode } from '@app/infrastructure/testing'
import {
  E2E_PASSWORD,
  adminQuery,
  inviteLink,
  newMember,
  newPerson,
  ownAddress,
  resetLink,
  signIn,
  signInFromPage,
} from './support/people.ts'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

// low entropy on purpose: a made-up value, not a secret for the leak scanner
const NEW_PASSWORD = 'tramonto-fiume-scala-violino'

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

const skipPasskeyOffer = async (page: Page) => {
  const notNow = page.getByRole('button', { name: 'Non ora' })
  await notNow.click()
}

test('wrong password shows a generic inline error', async ({ page }) => {
  await page.goto('/accedi')
  // an address of its own: the per-account limit counts the other runs of this test too
  await page
    .getByLabel('Email', { exact: true })
    .fill(`nessuno-${randomUUID().slice(0, 8)}@example.test`)
  await page.getByLabel('Password', { exact: true }).fill('sbagliata-123456')
  await page.getByRole('button', { name: 'Accedi con la password' }).click()
  await expect(page.getByRole('alert')).toHaveText('Email o password non corretti')
})

test('a protected page leads to sign-in and back, with the profile theme', async ({ page }) => {
  const person = await newMember()
  const other = (await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches))
    ? 'light'
    : 'dark'
  await adminQuery('update users set theme = $1 where id = $2', [other, person.userId])
  await page.goto('/account/sicurezza')
  await expect(page).toHaveURL(/\/accedi\?dopo=(%2F|\/)account(%2F|\/)sicurezza$/)
  await page.getByLabel('Email', { exact: true }).fill(person.email)
  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD)
  await page.getByRole('button', { name: 'Accedi con la password' }).click()
  await skipPasskeyOffer(page)
  await expect(page).toHaveURL(/\/account\/sicurezza$/)
  if (other === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
  else await expect(page.locator('html')).not.toHaveClass(/dark/)
})

test('after sign-in the agency home opens; another agency address is not found', async ({
  page,
}) => {
  const person = await newMember()
  await signInFromPage(page, person)
  await skipPasskeyOffer(page)
  await expect(page).toHaveURL(new RegExp(`/${person.organizationSlug}$`))
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Agenzia')
  await page.goto(`/${randomUUID()}`)
  await expect(page.getByRole('heading', { name: 'Pagina non trovata' })).toBeVisible()
  // signed in, the sign-in page goes straight in
  await page.goto('/accedi')
  await expect(page).toHaveURL(new RegExp(`/${person.organizationSlug}$`))
})

test('sign-in with the authenticator app code', async ({ page }) => {
  const person = await newPerson('Anna Admin', 'admin')
  await signIn(page.request, person)
  // the role asks for 2FA: the panel sends the session to set it up
  await page.goto('/account')
  await expect(page).toHaveURL(/\/accedi\/secondo-fattore$/)
  await page.getByRole('button', { name: "Usa l'app di autenticazione" }).click()
  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD)
  await page.getByRole('button', { name: 'Continua' }).click()
  const secret = await enrolFromPage(page)
  await expect(page).toHaveURL(new RegExp(`/${person.organizationSlug}$`))

  await page.context().clearCookies()
  await signInFromPage(page, person)
  await expect(page).toHaveURL(/\/accedi\/verifica$/)
  await page.getByLabel("Codice dell'app").fill(totpCode(secret))
  await page.getByRole('button', { name: 'Verifica' }).click()
  await expect(page).toHaveURL(new RegExp(`/${person.organizationSlug}$`))
})

/** Key, code, recovery codes: returns the key. */
async function enrolFromPage(page: Page): Promise<string> {
  const link = await page
    .getByRole('link', { name: "Apri nell'app di autenticazione" })
    .getAttribute('href')
  const secret = secretOf(link ?? '')
  await page.getByLabel('Codice di 6 cifre').fill(totpCode(secret))
  await page.getByRole('button', { name: 'Verifica e attiva' }).click()
  await expect(
    page.getByRole('list', { name: 'Codici di recupero' }).getByRole('listitem'),
  ).toHaveCount(10)
  await page.getByRole('button', { name: 'Li ho salvati' }).click()
  return secret
}

test('activation with a password and 2FA lands on the agency home', async ({ page }) => {
  const email = `attiva-${randomUUID().slice(0, 8)}@example.test`
  const { path, organizationSlug } = await inviteLink(email, 'admin')
  await page.goto(path)
  await expect(page.getByText(email)).toBeVisible()
  await page.getByLabel('Nome e cognome').fill('Marta Neri')
  await page.getByRole('radio', { name: /^Password/ }).check()
  await page.getByRole('textbox', { name: /^Password/ }).fill(NEW_PASSWORD)
  await page.getByRole('button', { name: "Attiva l'account" }).click()
  await enrolFromPage(page)
  await expect(page).toHaveURL(new RegExp(`/${organizationSlug}$`))
})

test('an existing user accepts an invite after signing in, without a password form', async ({
  page,
}) => {
  const person = await newMember()
  const { path, organizationSlug } = await inviteLink(person.email, 'member')
  await page.goto(path)
  await expect(page.getByLabel('Nome e cognome')).toHaveCount(0)
  await page.getByRole('link', { name: 'Accedi per accettare' }).click()
  await page.getByLabel('Email', { exact: true }).fill(person.email)
  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD)
  await page.getByRole('button', { name: 'Accedi con la password' }).click()
  await skipPasskeyOffer(page)
  await expect(page).toHaveURL(new RegExp(`/attiva/`))
  await page.getByRole('button', { name: "Accetta l'invito" }).click()
  await expect(page).toHaveURL(new RegExp(`/${organizationSlug}$`))
})

// Without the system email the page tells to ask the agency (MAIL_NOT_CONFIGURED, covered by
// email-change.int.test.ts): the test server always has a mailer.
test('forgot password answers the same whether or not the address exists', async ({ page }) => {
  await page.goto('/accedi')
  await page.getByRole('link', { name: 'Password dimenticata?' }).click()
  await expect(page.getByRole('heading', { name: 'Password dimenticata' })).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill('qualcuno@example.test')
  await page.getByRole('button', { name: 'Mandami il link' }).click()
  await expect(page.getByRole('status')).toContainText("Se l'indirizzo è registrato")
})

test('a reset link sets a new password that then signs in', async ({ page }) => {
  const person = await newMember()
  await page.goto(await resetLink(person.userId))
  await expect(page).toHaveURL(/\/reimposta$/)
  await page.getByLabel('Nuova password').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Salva la password' }).click()
  await expect(page.getByRole('status')).toHaveText('Password cambiata. Ora puoi accedere.')
  // the link works once
  await page.goto(await resetLink(person.userId).then((l) => l.replace(/[^/]+\?/, 'non-valido?')))
  await expect(page.getByRole('alert')).toContainText('non è valido')

  await page.goto('/accedi')
  await page.getByLabel('Email', { exact: true }).fill(person.email)
  await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Accedi con la password' }).click()
  await skipPasskeyOffer(page)
  await expect(page).toHaveURL(new RegExp(`/${person.organizationSlug}$`))
})

test('login screens have no a11y violations', async ({ page }) => {
  const { path } = await inviteLink(`a11y-${randomUUID().slice(0, 8)}@example.test`)
  for (const p of [
    '/accedi',
    '/accedi/password-dimenticata',
    '/accedi/verifica',
    '/reimposta',
    path,
  ]) {
    await page.goto(p)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect((await axe(page)).violations, p).toEqual([])
  }
})

test('the system email page is for the platform administrator only', async ({ page }) => {
  const member = await newMember()
  await signIn(page.request, member)
  await page.goto('/piattaforma/email')
  await expect(page.getByRole('heading', { name: 'Pagina non trovata' })).toBeVisible()

  const admin = await newMember('Matteo Piattaforma')
  await adminQuery("update users set platform_role = 'admin' where id = $1", [admin.userId])
  await page.context().clearCookies()
  await signIn(page.request, admin)
  // the platform administrator needs the second factor first
  await page.goto('/piattaforma/email')
  await expect(page).toHaveURL(/\/accedi\/secondo-fattore$/)
  await page.getByRole('button', { name: "Usa l'app di autenticazione" }).click()
  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD)
  await page.getByRole('button', { name: 'Continua' }).click()
  await enrolFromPage(page)
  await page.goto('/piattaforma/email')
  // the settings are the platform's, shared by the tests running alongside: any state will do
  await expect(page.getByRole('heading', { name: 'Server SMTP' })).toBeVisible()
  await page.getByRole('textbox', { name: /^Server/ }).fill('smtp.example.test')
  await page.getByRole('textbox', { name: /^Utente/ }).fill('feedway')
  await page.getByRole('textbox', { name: /^Indirizzo del mittente/ }).fill('noreply@example.test')
  await page.getByLabel('Password SMTP').fill('segreto-di-prova')
  await page.getByRole('button', { name: 'Salva' }).click()
  // a change of the system email needs a fresh confirmation
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Password').fill(E2E_PASSWORD)
  await dialog.getByRole('button', { name: 'Conferma' }).click()
  await expect(page.getByRole('status')).toHaveText('Modifiche salvate.')
  await expect(page.getByText('Configurata', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Password SMTP')).toHaveValue('')
  expect((await axe(page)).violations).toEqual([])
})

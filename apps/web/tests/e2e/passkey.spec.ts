import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { totpCode } from '@app/infrastructure/testing'
import {
  adminQuery,
  E2E_PASSWORD,
  inviteLink,
  newMember,
  newPerson,
  ownAddress,
  signIn,
  signInFromPage,
} from './support/people.ts'
import { addVirtualAuthenticator } from './support/virtual-authenticator.ts'

// The virtual authenticator is a DevTools feature: every project here runs Chromium.
test.skip(({ browserName }) => browserName !== 'chromium', 'virtual authenticator needs Chromium')

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(({ baseURL }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
})

const sessionsOf = (userId: string) =>
  adminQuery<{ id: string; reauthenticated_at: Date | null; auth_method: string }>(
    'select id, reauthenticated_at, auth_method from sessions where user_id = $1',
    [userId],
  )

async function addPasskey(page: Page) {
  const passkeys = page.getByRole('region', { name: 'Passkey' })
  await passkeys.getByRole('button', { name: 'Aggiungi passkey' }).click()
  await expect(passkeys.getByRole('status')).toHaveText('Passkey aggiunta.')
  return passkeys
}

test('passkey added from the security page is audited and mailed, renamed and removed', async ({
  page,
}) => {
  const person = await newMember()
  await addVirtualAuthenticator(page)
  await signIn(page.request, person)
  await page.goto('/account/sicurezza')
  const passkeys = page.getByRole('region', { name: 'Passkey' })
  await expect(passkeys.getByText('Non hai ancora aggiunto passkey.')).toBeVisible()

  await addPasskey(page)
  const list = passkeys.getByRole('list', { name: 'Passkey' })
  await expect(list.getByRole('listitem').filter({ hasText: 'Passkey' })).toHaveCount(1)
  const audit = await adminQuery<{ action: string }>(
    'select action from audit_log where actor_id = $1',
    [person.userId],
  )
  expect(audit.map((a) => a.action)).toContain('auth.passkey_added')
  const mails = await adminQuery<{ kind: string }>(
    `select data->>'kind' as kind from pgboss.job
     where name = 'identity.security_email' and data->>'userId' = $1`,
    [person.userId],
  )
  expect(mails.map((m) => m.kind)).toContain('passkey_added')

  await list.getByRole('button', { name: 'Rinomina Passkey' }).click()
  await passkeys.getByRole('textbox', { name: 'Nome della passkey' }).fill('Portatile')
  await passkeys.getByRole('button', { name: 'Salva' }).click()
  await expect(passkeys.getByRole('status')).toHaveText('Nome salvato.')
  await expect(list.getByText('Portatile')).toBeVisible()

  // removing weakens the account: the panel asks the password again first
  const remove = list.getByRole('button', { name: 'Elimina Portatile' })
  await remove.click()
  const dialog = page.getByRole('dialog', { name: 'Conferma che sei tu' })
  await expect(dialog).toBeVisible()
  // nothing is removed, and nothing says so, until the person confirms
  await expect(passkeys.getByRole('status')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(passkeys.getByRole('status')).toHaveCount(0)
  await expect(passkeys.getByRole('alert')).toHaveCount(0)
  expect(
    await adminQuery('select id from passkeys where user_id = $1', [person.userId]),
  ).toHaveLength(1)

  await remove.click()
  await dialog.getByLabel('Password').fill(E2E_PASSWORD)
  await dialog.getByRole('button', { name: 'Conferma' }).click()
  await expect(passkeys.getByRole('status')).toHaveText('Passkey eliminata.')
  await expect(passkeys.getByText('Non hai ancora aggiunto passkey.')).toBeVisible()
  expect(
    await adminQuery('select id from passkeys where user_id = $1', [person.userId]),
  ).toHaveLength(0)
})

test('passkey reauth replaces the session with a reauthenticated one', async ({ page }) => {
  const person = await newMember()
  await addVirtualAuthenticator(page)
  await signIn(page.request, person)
  await page.goto('/account/sicurezza')
  const passkeys = await addPasskey(page)
  const before = await sessionsOf(person.userId)
  expect(before).toHaveLength(1)
  expect(before[0]?.reauthenticated_at).toBeNull()

  await passkeys.getByRole('button', { name: /^Elimina / }).click()
  await page
    .getByRole('dialog', { name: 'Conferma che sei tu' })
    .getByRole('button', { name: 'Usa una passkey' })
    .click()
  await expect(passkeys.getByRole('status')).toHaveText('Passkey eliminata.')

  const after = await sessionsOf(person.userId)
  expect(after).toHaveLength(1)
  expect(after[0]?.id).not.toBe(before[0]?.id)
  expect(after[0]?.reauthenticated_at).not.toBeNull()
  expect(after[0]?.auth_method).toBe('passkey')
})

test('an owner cannot turn off the only second factor, and the panel says why', async ({
  page,
}) => {
  const person = await newMember()
  await signIn(page.request, person)
  await ownAddress(page)
  await page.goto('/account/sicurezza')

  // the authenticator app, set up from the page as a person would
  const totp = page.getByRole('region', { name: 'App di autenticazione' })
  await totp.getByLabel('Password attuale').fill(E2E_PASSWORD)
  await totp.getByRole('button', { name: "Attiva l'app di autenticazione" }).click()
  const secret = (await totp.getByLabel("Chiave da scrivere nell'app").innerText()).replace(
    /\s/g,
    '',
  )
  await totp.getByRole('textbox', { name: 'Codice di 6 cifre' }).fill(totpCode(secret))
  await totp.getByRole('button', { name: 'Verifica e attiva' }).click()
  await expect(
    totp.getByRole('list', { name: 'Codici di recupero' }).getByRole('listitem'),
  ).toHaveCount(10)
  await totp.getByRole('button', { name: 'Li ho salvati' }).click()
  await expect(totp.getByText('Attiva', { exact: true })).toBeVisible()

  // new codes: the password typed in the confirmation dialog is the one the call needs
  await totp.getByRole('button', { name: 'Nuovi codici di recupero' }).click()
  const dialog = page.getByRole('dialog', { name: 'Conferma che sei tu' })
  await dialog.getByLabel('Password').fill(E2E_PASSWORD)
  await dialog.getByRole('button', { name: 'Conferma' }).click()
  await expect(
    totp.getByRole('list', { name: 'Codici di recupero' }).getByRole('listitem'),
  ).toHaveCount(10)
  await totp.getByRole('button', { name: 'Li ho salvati' }).click()

  // now the person becomes the owner: the role requires a second factor
  await adminQuery("update organization_members set role = 'owner' where user_id = $1", [
    person.userId,
  ])
  await page.reload()
  const disable = totp.getByRole('button', { name: 'Disattiva' })
  await expect(disable).toBeDisabled()
  await expect(
    totp.getByText('La verifica in due passaggi è obbligatoria per il tuo ruolo'),
  ).toBeVisible()
  // the server says no as well, even with a fresh confirmation
  const origin = new URL(process.env.E2E_BASE_URL ?? '').origin
  const headers = { origin, 'x-app-request': '1' }
  expect(
    (
      await page.request.post('/api/v1/auth/reauth', { headers, data: { password: E2E_PASSWORD } })
    ).status(),
  ).toBe(200)
  const res = await page.request.post('/api/auth/two-factor/disable', {
    headers,
    data: { password: E2E_PASSWORD },
  })
  expect(res.status()).toBe(403)
})

test('activation with a passkey signs in with that passkey', async ({ page }) => {
  await addVirtualAuthenticator(page)
  await ownAddress(page)
  const email = `pk-${randomUUID().slice(0, 8)}@example.test`
  const { path, organizationSlug } = await inviteLink(email, 'admin')
  await page.goto(path)
  await page.getByLabel('Nome e cognome').fill('Pia Chiave')
  await expect(page.getByRole('radio', { name: /^Passkey/ })).toBeChecked()
  await page.getByRole('button', { name: "Attiva l'account" }).click()
  await expect(page).toHaveURL(new RegExp(`/${organizationSlug}$`))
  const [user] = await adminQuery<{ id: string }>('select id from users where email = $1', [email])
  const sessions = await sessionsOf(user?.id ?? '')
  expect(sessions.map((s) => s.auth_method)).toEqual(['passkey'])
})

test('passkey is proposed after password sign-in, then signs in without password', async ({
  page,
}) => {
  await addVirtualAuthenticator(page)
  await ownAddress(page)
  const person = await newMember()
  await signInFromPage(page, person)
  await page.getByRole('button', { name: 'Crea una passkey' }).click()
  await expect(page).toHaveURL(new RegExp(`/${person.organizationSlug}$`))
  await page.context().clearCookies()
  await page.goto('/accedi')
  await page.getByRole('button', { name: 'Accedi con passkey' }).click()
  await expect(page).toHaveURL(new RegExp(`/${person.organizationSlug}$`))
  expect((await sessionsOf(person.userId)).map((s) => s.auth_method)).toContain('passkey')
})

test('admin with a passkey who signs in with the password is told to use the passkey', async ({
  page,
  browser,
  baseURL,
}) => {
  await addVirtualAuthenticator(page)
  await ownAddress(page)
  const person = await newPerson('Ada Admin', 'admin')
  // the first passkey of an admin, set up right after the password sign-in
  await signIn(page.request, person)
  await page.goto('/accedi/secondo-fattore')
  await page.getByRole('button', { name: 'Crea una passkey' }).click()
  await expect(page).toHaveURL(new RegExp(`/${person.organizationSlug}$`))

  // another browser, without the passkey (here it would sign in from the email field)
  const other = await browser.newContext({ baseURL: baseURL ?? '' })
  try {
    const elsewhere = await other.newPage()
    await ownAddress(elsewhere)
    await signInFromPage(elsewhere, person)
    await expect(elsewhere).toHaveURL(/\/accedi\/secondo-fattore$/)
    await expect(elsewhere.getByText('esci e accedi con quella')).toBeVisible()
    await expect(elsewhere.getByRole('button', { name: 'Crea una passkey' })).toHaveCount(0)
  } finally {
    await other.close()
  }
})

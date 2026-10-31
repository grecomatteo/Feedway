import AxeBuilder from '@axe-core/playwright'
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import {
  E2E_PASSWORD,
  addPasskeyRow,
  addPerson,
  adminQuery,
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

async function createWorkspace(page: Page, name: string) {
  await page.getByLabel('Nome del nuovo cliente').fill(name)
  await page.getByRole('button', { name: 'Crea', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Clienti' }).getByText(name)).toBeVisible()
}

async function workspaceId(org: string, name: string): Promise<string> {
  const [row] = await adminQuery<{ id: string }>(
    'select id from workspaces where organization_id = $1 and name = $2',
    [org, name],
  )
  if (!row) throw new Error(`no workspace ${name}`)
  return row.id
}

async function confirmWithPassword(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Conferma che sei tu' })
  await dialog.getByLabel('Password').fill(E2E_PASSWORD)
  await dialog.getByRole('button', { name: 'Conferma' }).click()
}

/** An Owner with the second factor, an agency with clients A and B, a Publisher of A only. */
async function agencyWithPublisher(page: Page) {
  const owner = await newPerson('Olga Owner', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await page.goto(`/${org}/spazi`)
  await createWorkspace(page, 'Cliente A')
  await createWorkspace(page, 'Cliente B')
  const a = await workspaceId(org, 'Cliente A')
  const collab = await addPerson(org, 'Carla Collab', 'member', [
    { workspaceId: a, role: 'publisher' },
  ])
  return { owner, org, collab }
}

test('workspaces and invite: a publisher sees only their client and no users page', async ({
  page,
  browser,
  baseURL,
}) => {
  const { org, collab } = await agencyWithPublisher(page)

  await page.goto(`/${org}/utenti`)
  await page.getByRole('button', { name: 'Invita' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Email').fill('nuova-persona@example.test')
  await dialog.getByRole('combobox', { name: 'Cliente A' }).click()
  await page.getByRole('option', { name: 'Publisher' }).click()
  await dialog.getByRole('button', { name: "Invia l'invito" }).click()
  await expect(page.getByRole('status')).toContainText(
    'Invito inviato a nuova-persona@example.test',
  )
  await expect(page.getByRole('region', { name: 'Inviti in attesa' })).toContainText(
    'Publisher di Cliente A',
  )

  const other = await browser.newContext({ baseURL: baseURL ?? '' })
  try {
    const p = await other.newPage()
    await ownAddress(p)
    await signIn(p.request, collab)
    await p.goto(`/${org}/spazi`)
    const list = p.getByRole('list', { name: 'Clienti' })
    await expect(list.getByText('Cliente A')).toBeVisible()
    await expect(list.getByText('Cliente B')).toHaveCount(0)
    await expect(p.getByRole('link', { name: 'Utenti' })).toHaveCount(0)
    await p.goto(`/${org}/utenti`)
    await expect(p.getByRole('heading', { name: 'Pagina non trovata' })).toBeVisible()
  } finally {
    await other.close()
  }
})

test('context switcher: hidden and unknown client slugs fall back the same way', async ({
  page,
  browser,
  baseURL,
}) => {
  const { org, collab } = await agencyWithPublisher(page)
  const other = await browser.newContext({ baseURL: baseURL ?? '' })
  try {
    const p = await other.newPage()
    await ownAddress(p)
    await signIn(p.request, collab)
    const [b] = await adminQuery<{ slug: string }>(
      "select slug from workspaces where organization_id = $1 and name = 'Cliente B'",
      [org],
    )
    const hidden = await p.goto(`/${org}/spazi?spazio=${b?.slug ?? ''}`)
    await expect(p.getByRole('list', { name: 'Clienti' })).toBeVisible()
    const hiddenHtml = await p.getByRole('main').innerHTML()
    const unknown = await p.goto(`/${org}/spazi?spazio=non-esiste`)
    await expect(p.getByRole('list', { name: 'Clienti' })).toBeVisible()
    const unknownHtml = await p.getByRole('main').innerHTML()
    expect(hidden?.status()).toBe(unknown?.status())
    expect(hiddenHtml).toBe(unknownHtml)
    await expect(p.getByRole('button', { name: 'Contesto' }).first()).toHaveText(/Tutti i clienti/)
  } finally {
    await other.close()
  }
})

test('a person in two agencies switches, and another agency address is not found', async ({
  page,
}) => {
  const owner = await newPerson('Olga Due', 'owner')
  // the slug is the id, as for every agency created by the panel
  const id = randomUUID()
  const [second] = await adminQuery<{ id: string }>(
    "insert into organizations (id, name, slug, status) values ($1::uuid, 'Agenzia Due', $1::text, 'active') returning id",
    [id],
  )
  await adminQuery(
    "insert into organization_members (organization_id, user_id, role, status) values ($1, $2, 'member', 'active')",
    [second?.id, owner.userId],
  )
  await signInWithTotp(page.request, owner)
  await page.goto(`/${owner.organizationSlug}`)
  await page.getByRole('button', { name: 'Agenzia' }).first().click()
  await page.getByRole('menuitemcheckbox', { name: 'Agenzia Due' }).click()
  await expect(page).toHaveURL(new RegExp(`/${second?.id ?? ''}$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Agenzia Due' })).toBeVisible()

  const stranger = await newPerson('Sara Estranea', 'member')
  await page.context().clearCookies()
  await signIn(page.request, stranger)
  await page.goto(`/${owner.organizationSlug}/spazi`)
  await expect(page.getByRole('heading', { name: 'Pagina non trovata' })).toBeVisible()
})

test('a role change asks for the confirmation and then runs', async ({ page }) => {
  const { org, collab } = await agencyWithPublisher(page)
  await page.goto(`/${org}/utenti`)
  await page.getByRole('combobox', { name: `Ruolo di ${collab.name} nell'agenzia` }).click()
  await page.getByRole('option', { name: 'Admin' }).click()
  await confirmWithPassword(page)
  await expect(page.getByRole('status')).toContainText(`Ruolo di ${collab.name} cambiato`)
  const [row] = await adminQuery<{ role: string }>(
    'select role from organization_members where organization_id = $1 and user_id = $2',
    [org, collab.userId],
  )
  expect(row?.role).toBe('admin')
})

test('inviting an Admin asks for the confirmation first', async ({ page }) => {
  const owner = await newPerson('Olga Invita', 'owner')
  await signInWithTotp(page.request, owner)
  await page.goto(`/${owner.organizationSlug}/utenti`)
  await page.getByRole('button', { name: 'Invita' }).click()
  const dialog = page.getByRole('dialog', { name: 'Invita una persona' })
  await dialog.getByLabel('Email').fill('nuovo-admin@example.test')
  await dialog.getByRole('radio', { name: 'Admin' }).check()
  await dialog.getByRole('button', { name: "Invia l'invito" }).click()
  await confirmWithPassword(page)
  await expect(page.getByRole('status')).toContainText('Invito inviato a nuovo-admin@example.test')
  const [row] = await adminQuery<{ org_role: string }>(
    'select org_role from invites where organization_id = $1 and email = $2',
    [owner.organizationSlug, 'nuovo-admin@example.test'],
  )
  expect(row?.org_role).toBe('admin')
})

test('the owner passes ownership to an admin and becomes admin', async ({ page }) => {
  const owner = await newPerson('Olga Proprietaria', 'owner')
  const admin = await addPerson(owner.organizationSlug, 'Aldo Admin', 'admin')
  await addPasskeyRow(admin.userId)
  await signInWithTotp(page.request, owner)
  await page.goto(`/${owner.organizationSlug}/utenti`)
  await page.getByRole('button', { name: 'Passa la proprietà' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: admin.name }).check()
  await dialog.getByRole('button', { name: 'Passa la proprietà' }).click()
  await confirmWithPassword(page)
  // the role changed, so both are signed out everywhere: the former owner signs in again
  await expect(page).toHaveURL(/\/accedi\?/)
  await expect(page.getByRole('status')).toContainText('Il tuo ruolo è cambiato')
  const roles = await adminQuery<{ user_id: string; role: string }>(
    'select user_id, role from organization_members where organization_id = $1',
    [owner.organizationSlug],
  )
  expect(roles.find((r) => r.user_id === owner.userId)?.role).toBe('admin')
  expect(roles.find((r) => r.user_id === admin.userId)?.role).toBe('owner')
  const sessions = await adminQuery<{ n: string }>(
    'select count(*) as n from sessions where user_id = any($1)',
    [[owner.userId, admin.userId]],
  )
  expect(sessions[0]?.n).toBe('0')
})

test('agency screens have no a11y violations', async ({ page }) => {
  const { org } = await agencyWithPublisher(page)
  for (const path of [
    '/agenzie',
    `/${org}`,
    `/${org}/utenti`,
    `/${org}/spazi`,
    `/${org}/registro`,
    `/${org}/impostazioni`,
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('status')).toHaveCount(0)
    expect((await axe(page)).violations, path).toEqual([])
  }
  const [a] = await adminQuery<{ slug: string }>(
    "select slug from workspaces where organization_id = $1 and name = 'Cliente A'",
    [org],
  )
  await page.goto(`/${org}/spazi/${a?.slug ?? ''}/membri`)
  await expect(page.getByRole('list', { name: 'Persone del cliente' })).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
  // the log shows what just happened
  await page.goto(`/${org}/registro`)
  await expect(page.getByRole('list', { name: 'Registro attività' })).toContainText(
    'ha creato un cliente',
  )
})

test('settings: the owner renames the agency after the confirmation', async ({ page }) => {
  const owner = await newPerson('Olga Impostazioni', 'owner')
  await signInWithTotp(page.request, owner)
  await page.goto(`/${owner.organizationSlug}/impostazioni`)
  await page.getByLabel("Nome dell'agenzia").fill('Studio Aurora')
  await page.getByRole('button', { name: 'Salva' }).click()
  await confirmWithPassword(page)
  await expect(page.getByRole('status')).toHaveText('Modifiche salvate.')
})

test('mobile nav below 768 px: five places, no + yet, no a11y violations', async ({ page }) => {
  const owner = await newPerson('Olga Telefono', 'owner')
  await signInWithTotp(page.request, owner)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/${owner.organizationSlug}/spazi`)
  const nav = page.getByRole('navigation', { name: 'Navigazione principale' })
  await expect(nav).toBeVisible()
  await expect(nav.getByRole('listitem')).toHaveCount(5)
  await expect(nav.getByRole('link', { name: 'Nuovo post' })).toHaveCount(0)
  expect((await axe(page)).violations).toEqual([])
})

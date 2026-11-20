import AxeBuilder from '@axe-core/playwright'
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { DESIGN_NOW, romeInstant } from './support/design-sample.ts'
import { libraryFile } from './support/media.ts'
import { connectedAgency, newWorkspace } from './support/meta.ts'
import { adminQuery, newPerson, ownAddress, signInWithTotp } from './support/people.ts'

// «Oggi» (Task R3, screens 02 and 03): what needs a hand, what goes out this week, the drafts to
// finish and the clients worked on last, with the browser stopped on Thursday 19 November 2026
// 10:00 in Rome.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
  await page.clock.setFixedTime(DESIGN_NOW)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

async function send(page: Page, path: string, data: unknown) {
  const res = await page.request.post(path, {
    headers: { origin: new URL(process.env.E2E_BASE_URL ?? '').origin, 'x-app-request': '1' },
    data,
  })
  expect(res.status(), `POST ${path}`).toBe(200)
  return (await res.json()) as { id: string }
}

/**
 * Two clients of an Owner: Forno Prova, whose Facebook Page stopped working, with a post today
 * and a draft; Osteria Prova, with a post on Tuesday and one tomorrow and a file that failed.
 */
async function agency(page: Page, name: string) {
  const owner = await newPerson(name, 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  const forno = await newWorkspace(page.request, org, 'Forno Prova')
  const osteria = await newWorkspace(page.request, org, 'Osteria Prova')
  const { connectionId } = await connectedAgency(page.request, org, { importAccounts: false })
  const profile = async (workspaceId: string, platform: string, profileName: string) => {
    const id = randomUUID()
    const externalId = String(Math.floor(Math.random() * 1e15))
    await adminQuery(
      `insert into social_accounts (id, organization_id, platform, external_id, name, username,
                                    page_id, connection_id, health, last_synced_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'ok', now())`,
      [
        id,
        org,
        platform,
        externalId,
        profileName,
        platform === 'instagram' ? 'osteriaprova' : null,
        platform === 'facebook' ? externalId : null,
        connectionId,
      ],
    )
    await adminQuery(
      'insert into workspace_accounts (organization_id, workspace_id, account_id) values ($1, $2, $3)',
      [org, workspaceId, id],
    )
    return id
  }
  const page1 = await profile(forno.id, 'facebook', 'Forno Prova Bistrot')
  const ig = await profile(osteria.id, 'instagram', 'Osteria Prova')
  await adminQuery("update social_accounts set health = 'error' where id = $1", [page1])

  const post = async (workspaceId: string, accountId: string, caption: string, at?: string) => {
    const created = await send(page, `/api/v1/orgs/${org}/workspaces/${workspaceId}/posts`, {
      type: 'photo',
      caption: { common: caption },
      mediaIds: [],
      destinations: [{ accountId }],
    })
    if (!at) return
    // in place of «Programma», which refuses a time already gone
    await adminQuery(
      "update posts set status = 'scheduled', scheduled_by = created_by, scheduled_at = $2 where id = $1",
      [created.id, romeInstant(at)],
    )
    await adminQuery("update post_targets set status = 'scheduled' where post_id = $1", [
      created.id,
    ])
  }
  await post(forno.id, page1, 'Il pane del giovedì', '2026-11-19T12:00')
  await post(forno.id, page1, 'Focaccia da finire')
  await post(osteria.id, ig, 'Il pranzo del martedì', '2026-11-17T13:00')
  await post(osteria.id, ig, 'Il menu del venerdì', '2026-11-20T08:00')
  await libraryFile(org, osteria.id, owner.userId, {
    kind: 'video',
    name: 'IMG_0233.mov',
    status: 'failed',
    failure: 'timeout',
  })
  return { org, forno, osteria }
}

const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const week = (page: Page) => page.getByRole('group', { name: 'La settimana' })

test('the sections: what to fix, the week, the drafts and the clients', async ({
  page,
  isMobile,
}) => {
  const { org } = await agency(page, 'Olga Oggi')
  await page.goto(`/${org}`)
  await expect(page.locator('[data-ready]')).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Oggi')
  await expect(page.getByText('giovedì 19 novembre', { exact: true })).toBeVisible()

  // Da sistemare: the Page that stopped working and the file that did not load
  const issues = section(page, 'Da sistemare')
  await expect(issues.locator('[data-issue]')).toHaveCount(2)
  const profileRow = issues.locator('[data-issue="profile"]')
  await expect(profileRow).toContainText('Forno Prova Bistrot ha un problema')
  await expect(profileRow).toContainText(
    'Forno Prova · 1 post in programma su questa Pagina Facebook',
  )
  await expect(
    profileRow.getByRole('link', { name: 'Ricollega Forno Prova Bistrot' }),
  ).toHaveAttribute('href', `/${org}/impostazioni/integrazioni/meta`)
  await expect(issues.locator('[data-issue="media"]')).toContainText('IMG_0233.mov non caricato')
  if (!isMobile) await expect(page.locator('nav [data-count]')).toContainText('2 cose da sistemare')

  // In uscita: the week from Monday, today marked, a dash for each post
  const days = week(page).getByRole('button')
  await expect(days).toHaveCount(7)
  await expect(week(page).locator('[data-today]')).toContainText('oggi')
  await expect(days.nth(1)).toHaveAccessibleName('mar 17, 1 post')
  await expect(days.nth(6)).toHaveAccessibleName('dom 22, nessun post')
  const out = section(page, 'In uscita')
  await expect(out.getByRole('region', { name: 'Oggi' })).toContainText('Il pane del giovedì')
  await expect(out.getByRole('region', { name: 'Domani, venerdì 20' })).toContainText(
    'Il menu del venerdì',
  )
  await expect(out).not.toContainText('Il pranzo del martedì')

  // a click on a day shows that day; a second click goes back to today and tomorrow
  await days.nth(1).click()
  await expect(days.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(out.locator('[data-day-group]')).toHaveCount(1)
  await expect(out.getByRole('region', { name: 'Martedì 17' })).toContainText(
    'Il pranzo del martedì',
  )
  await days.nth(1).click()
  await expect(out.locator('[data-day-group]')).toHaveCount(2)

  // the drafts and the clients worked on
  await expect(section(page, 'Bozze da finire')).toContainText('Focaccia da finire')
  await expect(section(page, 'Bozze da finire')).toContainText('mancano i file')
  const recent = section(page, 'Clienti recenti')
  await expect(recent.getByRole('link', { name: 'Forno Prova' })).toBeVisible()
  await expect(recent.getByRole('link', { name: 'Osteria Prova' })).toBeVisible()
  expect((await axe(page)).violations).toEqual([])

  // «Riprova» prepares the file again: its row goes, and the count with it; the issues are read
  // again from the moment of the click, not from when the panel opened
  const later = new Date(DESIGN_NOW.getTime() + 60 * 60 * 1000)
  await page.clock.setFixedTime(later)
  const reread = page.waitForRequest(
    (r) =>
      r.url().includes('/agenda/issues?') &&
      new URL(r.url()).searchParams.get('from') === later.toISOString(),
  )
  await issues.getByRole('button', { name: 'Riprova a preparare IMG_0233.mov' }).click()
  await reread
  await expect(issues.locator('[data-issue]')).toHaveCount(1)
  if (!isMobile) await expect(page.locator('nav [data-count]')).toContainText('1 cosa da sistemare')
})

test('the client of the selector narrows the page', async ({ page }) => {
  const { org, osteria } = await agency(page, 'Olga Filtro')
  await page.goto(`/${org}?spazio=${osteria.slug}`)
  await expect(page.locator('[data-ready]')).toHaveCount(1)
  await expect(
    page.getByRole('button', { name: /^Contesto:/ }).locator('visible=true'),
  ).toContainText('Osteria Prova')

  const issues = section(page, 'Da sistemare')
  await expect(issues.locator('[data-issue]')).toHaveCount(1)
  await expect(issues).toContainText('IMG_0233.mov')
  const out = section(page, 'In uscita')
  await expect(out.getByRole('region', { name: 'Oggi' })).toContainText('Niente in programma.')
  await expect(out).not.toContainText('Il pane del giovedì')
  await expect(out).toContainText('Il menu del venerdì')
  await expect(week(page).getByRole('button').nth(1)).toHaveAccessibleName('mar 17, 1 post')
  // Forno Prova's draft is not here, and the clients' list is for all of them only
  await expect(section(page, 'Bozze da finire')).toHaveCount(0)
  await expect(section(page, 'Clienti recenti')).toHaveCount(0)
})

test('nothing to fix and nothing going out: one calm line each', async ({ page }) => {
  const owner = await newPerson('Olga Vuota', 'owner')
  await signInWithTotp(page.request, owner)
  await newWorkspace(page.request, owner.organizationSlug, 'Cliente Calmo')
  await page.goto(`/${owner.organizationSlug}`)
  await expect(page.locator('[data-ready]')).toHaveCount(1)
  await expect(page.locator('[data-today-calm]')).toHaveText('Niente da sistemare.')
  await expect(section(page, 'Da sistemare')).toHaveCount(0)
  const empty = page.locator('[data-today-empty]')
  await expect(empty).toContainText('Niente in programma oggi e domani.')
  await expect(empty.getByRole('link', { name: 'Nuovo post' })).toBeVisible()
  await expect(section(page, 'Bozze da finire')).toHaveCount(0)
  expect((await axe(page)).violations).toEqual([])
})

test('a read that fails says so, and «Riprova» reads again', async ({ page }) => {
  const owner = await newPerson('Olga Errore', 'owner')
  await signInWithTotp(page.request, owner)
  let failing = true
  await page.route(/\/agenda\?/, async (route) => {
    if (failing) await route.fulfill({ status: 500, body: '{}' })
    else await route.continue()
  })
  await page.goto(`/${owner.organizationSlug}`)
  const out = section(page, 'In uscita')
  await expect(out.getByRole('alert')).toHaveText(/Non siamo riusciti a leggere i post in uscita/)
  // the same row as every other failed read: the red sign and «Riprova» (D, state 1)
  await expect(out.locator('[data-load-failed]')).toBeVisible()
  // the strip does not claim the days are free when it could not read them
  await expect(week(page).getByRole('button').nth(1)).toHaveAccessibleName('mar 17')
  await expect(week(page)).not.toContainText('libero')
  failing = false
  await out.getByRole('button', { name: 'Riprova' }).click()
  await expect(out.getByRole('alert')).toHaveCount(0)
  await expect(page.locator('[data-today-empty]')).toBeVisible()
})

test('on a phone: one column, the week with dots, nothing sideways', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone only')
  const { org } = await agency(page, 'Olga Telefono')
  await page.goto(`/${org}`)
  await expect(page.locator('[data-ready]')).toHaveCount(1)
  const days = week(page).getByRole('button')
  await expect(days).toHaveCount(7)
  // the count of posts under the number gives way to the dots
  await expect(days.nth(3)).not.toContainText('post', { useInnerText: true })
  const out = await section(page, 'In uscita').boundingBox()
  const drafts = await section(page, 'Bozze da finire').boundingBox()
  expect(drafts?.y ?? 0).toBeGreaterThan((out?.y ?? 0) + (out?.height ?? 0) - 1)
  // the client of a post goes under its text
  await expect(
    section(page, 'In uscita').getByText('Forno Prova', { exact: true }).locator('visible=true'),
  ).toHaveCount(1)
  // a row is time, picture and text: the platforms stay off it, never on a line of their own
  await expect(
    section(page, 'In uscita').locator('[data-post] [data-platforms]').locator('visible=true'),
  ).toHaveCount(0)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('a failed read of what to fix says so, and «Riprova» reads again', async ({ page }) => {
  const owner = await newPerson('Olga Problemi', 'owner')
  await signInWithTotp(page.request, owner)
  let failing = true
  await page.route(/\/agenda\/issues\?/, async (route) => {
    if (failing) await route.fulfill({ status: 500, body: '{}' })
    else await route.continue()
  })
  await page.goto(`/${owner.organizationSlug}`)
  const failed = page.locator('[data-today-issues-failed]')
  await expect(failed).toHaveRole('alert')
  await expect(failed).toHaveAttribute('data-load-failed')
  await expect(failed).toContainText('Non siamo riusciti a leggere cosa c’è da sistemare.')
  await expect(page.locator('[data-today-calm]')).toHaveCount(0)
  failing = false
  await failed.getByRole('button', { name: 'Riprova' }).click()
  await expect(page.locator('[data-today-calm]')).toHaveText('Niente da sistemare.')
})

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { libraryFile } from './support/media.ts'
import { assignAccount, connectedAgency, newWorkspace, send } from './support/meta.ts'
import {
  addPerson,
  adminQuery,
  newPerson,
  ownAddress,
  signIn,
  signInWithTotp,
} from './support/people.ts'

// «Pubblica subito» and the page of the outcome (plan 07 Task 9, Scelte 2 and 6; screens 11 and
// 13). The worker does not run in these tests: what it would write on the destinations is
// written here in the database, as the worker's own tests prove it writes it.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
const shots = process.env.E2E_SCREENSHOTS

const accountId = async (org: string, platform: string) =>
  (
    await adminQuery<{ id: string }>(
      "select id from social_accounts where organization_id = $1 and name = 'Forno Luce' and platform = $2",
      [org, platform],
    )
  )[0]?.id ?? ''

/** An agency with Forno Luce, its Page and its Instagram (working), and a photo in its library. */
async function clientWithPhoto(page: Page) {
  const owner = await newPerson('Olga Esito', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await connectedAgency(page.request, org)
  const client = await newWorkspace(page.request, org, 'Forno Luce')
  const ig = await accountId(org, 'instagram')
  const fb = await accountId(org, 'facebook')
  await assignAccount(page.request, org, client.id, fb)
  await assignAccount(page.request, org, client.id, ig)
  await adminQuery("update social_accounts set health = 'ok' where organization_id = $1", [org])
  const photo = await libraryFile(org, client.id, owner.userId, { kind: 'image', name: 'pane.jpg' })
  return { owner, org, client, ig, fb, photo }
}

/** What the worker would write on a destination, and the post's state it computes. */
async function worker(
  postId: string,
  accountId: string,
  status: string,
  extra: { permalink?: string; code?: string } = {},
) {
  await adminQuery(
    `update post_targets set status = $3, generation = generation + 1, permalink = $4,
       last_error_code = $5, published_at = case when $3 in ('published', 'confirmed') then now() end
     where post_id = $1 and account_id = $2`,
    [postId, accountId, status, extra.permalink ?? null, extra.code ?? null],
  )
}
const postIs = (postId: string, status: string) =>
  adminQuery('update posts set status = $2 where id = $1', [postId, status])

async function publishedNow(
  page: Page,
  org: string,
  clientId: string,
  photo: string,
  accounts: string[],
) {
  const base = `/api/v1/orgs/${org}/workspaces/${clientId}/posts`
  const draft = (await send(page.request, 'POST', base, {
    type: 'photo',
    mediaIds: [photo],
    caption: { common: 'Focaccia appena sfornata' },
    destinations: accounts.map((accountId) => ({ accountId })),
  })) as { id: string; version: number }
  await send(page.request, 'POST', `${base}/${draft.id}/publish-now`, { version: draft.version })
  return draft.id
}

test('«Pubblica subito»: the question with the accounts, then the outcome; one fails, «Riprova», then out', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'the computer; the phone below')
  const { org, client, ig, fb } = await clientWithPhoto(page)
  await page.goto(`/${org}/spazi/${client.slug}/post/nuovo`)
  await page.getByRole('button', { name: 'Dalla libreria' }).click()
  const library = page.getByRole('dialog', { name: 'Scegli dalla libreria' })
  await library.getByRole('button', { name: 'pane.jpg' }).click()
  await library.getByRole('button', { name: /^Aggiungi/ }).click()
  await page.getByRole('textbox', { name: 'Testo comune' }).fill('Il pane del lunedì')
  await page.locator('[data-when-mode="now"]').click()
  await expect(page.locator('[data-when-mode="now"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-when]')).toHaveCount(0)
  const button = page.locator('[data-schedule]')
  await expect(button).toBeEnabled({ timeout: 15_000 })
  await expect(button).toHaveText(/Pubblica su 2 account/)
  await button.click()
  const dialog = page.getByRole('dialog', { name: 'Pubblicare adesso?' })
  await expect(dialog.locator('[data-publish-now-list] li')).toHaveCount(2)
  await expect(dialog).toContainText('Forno Luce')
  await expect(dialog).toContainText('Dopo non si può annullare')
  expect((await axe(page)).violations).toEqual([])
  if (shots) await page.screenshot({ path: `${shots}/11-pubblica-subito.png` })
  await dialog.locator('[data-publish-now-confirm]').click()

  // the page of the outcome, with the side bar (screen 13)
  await expect(page.locator('[data-outcome-title]')).toHaveText('Il pane del lunedì')
  await expect(page.locator('[data-outcome-state]')).toHaveText('In pubblicazione')
  await expect(page.locator('[data-outcome-row]')).toHaveCount(2)
  await expect(page.locator('[data-outcome-activity]')).toContainText("l'ha pubblicato subito")
  const postId = page.url().split('/').pop() ?? ''

  // the worker: out on Instagram, refused by Facebook
  await worker(postId, ig, 'published', { permalink: 'https://www.instagram.com/p/AbC123/' })
  await worker(postId, fb, 'failed', { code: 'media_rejected' })
  await postIs(postId, 'partial')
  await page.reload()
  await expect(page.locator('[data-outcome-state]')).toHaveText('1 non uscito')
  const igRow = page.locator(`[data-outcome-row="${ig}"]`)
  await expect(igRow).toContainText('Pubblicato')
  await expect(igRow.getByRole('link', { name: 'Apri su Instagram' })).toHaveAttribute(
    'href',
    'https://www.instagram.com/p/AbC123/',
  )
  const fbRow = page.locator(`[data-outcome-row="${fb}"]`)
  await expect(fbRow).toContainText('Non uscito')
  await expect(fbRow.locator('[data-outcome-reason]')).toContainText(
    'Facebook ha rifiutato un file',
  )
  expect((await axe(page)).violations).toEqual([])
  if (shots) await page.screenshot({ path: `${shots}/13-esito.png`, fullPage: true })

  await fbRow.locator('[data-outcome-retry]').click()
  await expect(fbRow).toContainText('In attesa')
  await expect(page.locator('[data-outcome-activity]')).toContainText('ha riprovato su Forno Luce')
  await worker(postId, fb, 'published', { permalink: 'https://www.facebook.com/1/posts/2' })
  await postIs(postId, 'published')
  await page.reload()
  await expect(page.locator('[data-outcome-state]')).toHaveText('Pubblicato')
  await expect(fbRow.getByRole('link', { name: 'Apri su Facebook' })).toBeVisible()

  // the client's «Post»: «Pubblicati» in place of «Annullati»
  await page.goto(`/${org}/spazi/${client.slug}/post`)
  await expect(page.getByRole('button', { name: /Pubblicati/ })).toBeVisible()
  await expect(page.getByText('Pubblicato', { exact: true })).toBeVisible()
})

test('a post in pause: a Manager resumes it, a Publisher is told to ask', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'the computer; the phone below')
  const { org, client, ig, photo } = await clientWithPhoto(page)
  const postId = await publishedNow(page, org, client.id, photo, [ig])
  await worker(postId, ig, 'paused')
  await postIs(postId, 'paused')
  await page.goto(`/${org}/spazi/${client.slug}/post/${postId}`)
  await expect(page.locator('[data-outcome-state]')).toHaveText('In pausa')
  await expect(page.locator('[data-outcome-paused]')).toContainText('Chi l')
  await expect(page.locator('[data-outcome-resume]')).toBeVisible()
  expect((await axe(page)).violations).toEqual([])

  const publisher = await addPerson(org, 'Paolo Publisher', 'member', [
    { workspaceId: client.id, role: 'publisher' },
  ])
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? '' })
  const other = await context.newPage()
  await ownAddress(other)
  await signIn(other.request, publisher)
  await other.goto(`/${org}/spazi/${client.slug}/post/${postId}`)
  await expect(other.locator('[data-outcome-paused]')).toContainText('chiedi a un Manager')
  await expect(other.locator('[data-outcome-resume]')).toHaveCount(0)
  await context.close()

  // the time passed: «Riprendi» asks for a day and a time
  await adminQuery("update posts set scheduled_at = now() - interval '1 hour' where id = $1", [
    postId,
  ])
  await page.locator('[data-outcome-resume]').click()
  await expect(page.locator('[data-outcome-resume-when]')).toBeVisible()
  await expect(page.locator('[data-outcome-resume]')).toBeDisabled()
})

test('a post in preparation: «Modifica» opens the editor and saves it as a scheduled one (R13)', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'the same page on the phone')
  const { org, client, ig, fb, photo } = await clientWithPhoto(page)
  const base = `/api/v1/orgs/${org}/workspaces/${client.id}/posts`
  const ahead = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
  const draft = (await send(page.request, 'POST', base, {
    type: 'photo',
    mediaIds: [photo],
    caption: { common: 'Il pane del lunedì' },
    destinations: [{ accountId: ig }, { accountId: fb }],
    when: { localDate: ahead, localTime: '18:00' },
  })) as { id: string; version: number }
  await send(page.request, 'POST', `${base}/${draft.id}/schedule`, { version: draft.version })
  // Facebook cancelled on the page of the outcome; the worker took Instagram 15 minutes before
  await send(page.request, 'POST', `${base}/${draft.id}/destinations/${fb}/cancel`)
  await worker(draft.id, ig, 'ready')
  await postIs(draft.id, 'publishing')
  await page.goto(`/${org}/spazi/${client.slug}/post/${draft.id}`)
  await expect(page.locator('[data-outcome-state]')).toHaveText('In pubblicazione')
  await page.locator('[data-outcome-edit]').click()
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  const text = page.getByRole('textbox', { name: 'Testo comune' })
  await expect(text).toHaveValue('Il pane del lunedì')
  await text.fill('Il pane del lunedì, con il sesamo')
  await page.getByRole('button', { name: 'Salva modifiche' }).first().click()
  await expect
    .poll(
      async () =>
        (
          await adminQuery<{ caption: string; status: string }>(
            'select caption, status from posts where id = $1',
            [draft.id],
          )
        )[0],
    )
    .toEqual({ caption: 'Il pane del lunedì, con il sesamo', status: 'scheduled' })
  // the account cancelled stays out: saving does not schedule it again
  const targets = await adminQuery<{ account_id: string; status: string }>(
    'select account_id, status from post_targets where post_id = $1',
    [draft.id],
  )
  expect(targets.find((t) => t.account_id === ig)?.status).toBe('scheduled')
  expect(targets.find((t) => t.account_id === fb)?.status ?? 'cancelled').not.toBe('scheduled')

  // one destination being published: no «Modifica» any more
  await worker(draft.id, ig, 'publishing')
  await postIs(draft.id, 'publishing')
  await page.goto(`/${org}/spazi/${client.slug}/post/${draft.id}`)
  await expect(page.locator('[data-outcome-state]')).toHaveText('In pubblicazione')
  await expect(page.locator('[data-outcome-title]')).toBeVisible()
  await expect(page.locator('[data-outcome-edit]')).toHaveCount(0)
})

test('on a phone: the outcome under the post, with the bar at the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { org, client, ig, fb, photo } = await clientWithPhoto(page)
  const postId = await publishedNow(page, org, client.id, photo, [ig, fb])
  await worker(postId, ig, 'confirmed', { permalink: 'https://www.instagram.com/p/AbC123/' })
  await worker(postId, fb, 'failed', { code: 'too_late' })
  await postIs(postId, 'partial')
  await page.goto(`/${org}/spazi/${client.slug}/post/${postId}`)
  await expect(page.locator('[data-outcome-state]')).toHaveText('1 non uscito')
  await expect(page.locator(`[data-outcome-row="${fb}"] [data-outcome-reason]`)).toContainText(
    'troppo tempo',
  )
  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(390)
  expect((await axe(page)).violations).toEqual([])
  if (shots) await page.screenshot({ path: `${shots}/13-esito-telefono.png`, fullPage: true })
})

test('where people already look: «Oggi», the selector, «Clienti» and the library (Scelte 5 and 8)', async ({
  page,
  isMobile,
}) => {
  const { owner, org, client, ig, fb, photo } = await clientWithPhoto(page)
  // out on Instagram, refused by Facebook: «1 non uscito»
  const half = await publishedNow(page, org, client.id, photo, [ig, fb])
  await worker(half, ig, 'confirmed', { permalink: 'https://www.instagram.com/p/AbC123/' })
  await worker(half, fb, 'failed', { code: 'media_rejected' })
  await postIs(half, 'partial')
  // a second client with a post in pause: amber
  const bruna = await newWorkspace(page.request, org, 'Osteria Bruna')
  await assignAccount(page.request, org, bruna.id, ig)
  const brunaPhoto = await libraryFile(org, bruna.id, owner.userId, {
    kind: 'image',
    name: 'osteria.jpg',
  })
  const stopped = await publishedNow(page, org, bruna.id, brunaPhoto, [ig])
  await worker(stopped, ig, 'paused', { code: 'author_lost_permission' })
  await postIs(stopped, 'paused')

  // «Oggi»: the post not out first, in red, then the one in pause, in amber
  await page.goto(`/${org}`)
  const issues = page.locator('[data-today-issues]')
  await expect(issues.locator('[data-issue="post"]')).toHaveCount(2)
  const first = issues.locator('[data-issue="post"]').first()
  await expect(first).toContainText(/Foto (delle|dell’|del) .+ non uscita su Facebook/)
  await expect(first).toContainText('Forno Luce · un file non va bene per Facebook')
  await expect(first.locator('[data-tone="danger"]')).toHaveCount(1)
  const second = issues.locator('[data-issue="post"]').nth(1)
  await expect(second).toContainText('in pausa')
  await expect(second).toContainText('chi l’ha programmato non può più pubblicare')
  await expect(second.locator('[data-tone="warning"]')).toHaveCount(1)
  const row = page.locator(`[data-post="${half}"]`)
  await expect(row.getByText('1 non uscito').locator('visible=true')).toBeVisible()
  await expect(
    page.locator(`[data-post="${stopped}"]`).getByText('In pausa').locator('visible=true'),
  ).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
  if (shots)
    await page.screenshot({
      path: `${shots}/02-oggi${isMobile ? '-telefono' : ''}.png`,
      fullPage: true,
    })
  await first.getByRole('link', { name: /^Apri il post/ }).click()
  await expect(page.locator('[data-outcome-state]')).toHaveText('1 non uscito')

  // the selector: a red dot on Forno Luce, an amber one on Osteria Bruna (screen 04, D-87.3)
  await page.goto(`/${org}/spazi`)
  await page
    .getByRole('button', { name: /^Contesto:/ })
    .locator('visible=true')
    .click()
  const list = page.getByRole('listbox', { name: 'Contesto' })
  await expect(
    list.getByRole('option', { name: /Forno Luce ?, un post non uscito$/ }),
  ).toBeVisible()
  await expect(list.locator('[data-problem="notOut"]')).toHaveCount(1)
  await expect(
    list.getByRole('option', { name: /Osteria Bruna ?, un post in pausa$/ }),
  ).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
  if (shots)
    await page.screenshot({ path: `${shots}/04-selettore${isMobile ? '-telefono' : ''}.png` })
  await page.keyboard.press('Escape')

  // «Clienti»: the column «Collegamento» (screen 14)
  await page.goto(`/${org}/spazi`)
  const fornoRow = page.getByRole('row', { name: /Forno Luce/ })
  await expect(fornoRow.getByText('1 post non uscito')).toBeVisible()
  await expect(fornoRow.locator('[data-tone="danger"]')).toHaveCount(1)
  await expect(
    page.getByRole('row', { name: /Osteria Bruna/ }).getByText('1 post in pausa'),
  ).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
  if (shots)
    await page.screenshot({
      path: `${shots}/14-clienti${isMobile ? '-telefono' : ''}.png`,
      fullPage: true,
    })

  // the library: the photo of the post gone out says so (Scelta 5)
  await page.goto(`/${org}/spazi/${client.slug}/libreria`)
  await expect(page.locator('[data-used-in]').locator('visible=true').first()).toContainText(
    /^Pubblicato il \d+ \p{L}+/u,
  )
  if (shots)
    await page.screenshot({ path: `${shots}/19-libreria${isMobile ? '-telefono' : ''}.png` })
})

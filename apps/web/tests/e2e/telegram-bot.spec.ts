import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { TELEGRAM_MOCK } from '@app/telegram-mock'
import {
  E2E_PASSWORD,
  addDataKey,
  addPerson,
  adminQuery,
  newPerson,
  ownAddress,
  signInWithTotp,
} from './support/people.ts'
import { agencyBotFor } from './support/telegram.ts'

// The Telegram bots (plan 08 Task 7): the agency's own in Impostazioni → Integrazioni → Telegram,
// the platform's in Piattaforma → Integrazioni. The token is tried with the fake Bot API and
// never comes back.

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

const shots = process.env.E2E_SCREENSHOTS
const shot = (page: Page, name: string, isMobile: boolean) =>
  shots
    ? page.screenshot({
        path: `${shots}/${name}${isMobile ? '-telefono' : ''}.png`,
        fullPage: true,
      })
    : Promise.resolve()

async function confirmWithPassword(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Conferma che sei tu' })
  await dialog.getByLabel('Password').fill(E2E_PASSWORD)
  await dialog.getByRole('button', { name: 'Conferma' }).click()
}

test('the agency bot: the owner sets it and goes back to the platform’s, the admin reads', async ({
  page,
  browser,
  baseURL,
  isMobile,
}) => {
  const bot = await agencyBotFor(0)
  const owner = await newPerson('Olga Telegram', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  // the token is sealed with the agency's data key, as Meta's secret
  await addDataKey(org)
  await page.goto(`/${org}/impostazioni/integrazioni`)
  const entry = page
    .getByRole('list', { name: 'Integrazioni' })
    .getByRole('link', { name: /Bot Telegram/ })
  await expect(entry.getByTestId('telegram-entry-state')).toHaveText('Bot della piattaforma')
  expect((await axe(page)).violations).toEqual([])
  await entry.click()
  await expect(page).toHaveURL(new RegExp(`/${org}/impostazioni/integrazioni/telegram$`))
  await expect(page.getByTestId('telegram-bot-state')).toHaveText('Usa il bot della piattaforma')
  await expect(page.getByRole('region', { name: 'Come creare il bot' })).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
  await shot(page, 'telegram-agenzia-vuoto', isMobile)

  // a token Telegram does not know is not saved
  await page.getByLabel('Token del bot').fill('1000000009:AAtoken-che-telegram-non-conosce-000')
  await page.getByRole('button', { name: 'Prova e salva' }).click()
  await confirmWithPassword(page)
  await expect(page.getByText('Telegram non accetta questo token')).toBeVisible()
  await expect(page.getByTestId('telegram-bot-state')).toHaveText('Usa il bot della piattaforma')

  await page.getByLabel('Token del bot').fill(bot.token)
  await page.getByRole('button', { name: 'Prova e salva' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Bot salvato' })).toBeVisible()
  await expect(page.getByTestId('telegram-bot-state')).toHaveText('Attivo')
  await expect(page.getByTestId('telegram-bot-name')).toHaveText(`@${bot.username}`)
  // the token never comes back, nor sits in the page
  expect(await page.content()).not.toContain(bot.token)
  expect((await axe(page)).violations).toEqual([])
  await shot(page, 'telegram-agenzia-impostato', isMobile)

  await page.getByRole('button', { name: 'Sostituisci token' }).click()
  await expect(page.getByLabel('Token del bot')).toHaveValue('')
  await page.getByRole('button', { name: 'Annulla' }).click()
  await expect(page.getByLabel('Token del bot')).toHaveCount(0)

  // Telegram refused it later (revoked with @BotFather): red here and in the list
  await adminQuery(
    `update integrations set verified_at = null, rejected_at = now()
       where kind = 'telegram' and organization_id = (select id from organizations where slug = $1)`,
    [org],
  )
  await page.reload()
  await expect(page.getByTestId('telegram-bot-state')).toHaveText('Token rifiutato')
  await expect(page.getByText('Telegram ha rifiutato il token il')).toBeVisible()
  await page.goto(`/${org}/impostazioni/integrazioni`)
  await expect(page.getByTestId('telegram-entry-state')).toHaveText('Token rifiutato')
  await page.goto(`/${org}/impostazioni/integrazioni/telegram`)

  const admin = await addPerson(org, 'Ada Admin', 'admin')
  const context = await browser.newContext({ baseURL: baseURL ?? '' })
  const adminPage = await context.newPage()
  await ownAddress(adminPage)
  await signInWithTotp(adminPage.request, admin)
  await adminPage.goto(`/${org}/impostazioni/integrazioni/telegram`)
  await expect(adminPage.getByTestId('telegram-bot-name')).toHaveText(`@${bot.username}`)
  await expect(adminPage.getByRole('button', { name: 'Sostituisci token' })).toHaveCount(0)
  await expect(adminPage.getByTestId('telegram-bot-remove')).toHaveCount(0)
  await context.close()

  // back to the platform's bot, after a confirmation
  await page.getByTestId('telegram-bot-remove').click()
  const dialog = page.getByRole('dialog', { name: 'Torna al bot della piattaforma' })
  await expect(dialog).toContainText('collegare Telegram al bot della piattaforma')
  expect((await axe(page)).violations).toEqual([])
  await dialog.getByTestId('telegram-bot-remove-confirm').click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: 'Bot tolto' })).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
  await expect(page.getByTestId('telegram-bot-state')).toHaveText('Usa il bot della piattaforma')
})

test('the platform bot: only its administrator sets it, from the menu', async ({
  page,
  isMobile,
}) => {
  const member = await newPerson('Mario Membro', 'member')
  await signInWithTotp(page.request, member)
  await page.goto('/piattaforma/integrazioni')
  await expect(page.getByRole('heading', { name: 'Pagina non trovata' })).toBeVisible()
  await page.context().clearCookies()

  const admin = await newPerson('Matteo Piattaforma', 'owner')
  await adminQuery("update users set platform_role = 'admin' where id = $1", [admin.userId])
  await signInWithTotp(page.request, admin)
  await page.goto('/piattaforma/integrazioni')
  await expect(page.getByRole('heading', { name: 'Integrazioni della piattaforma' })).toBeVisible()
  await expect(page.getByTestId('telegram-bot-state')).toHaveText('Da configurare')
  expect((await axe(page)).violations).toEqual([])
  await shot(page, 'telegram-piattaforma-vuoto', isMobile)

  await page.getByLabel('Token del bot').fill(TELEGRAM_MOCK.bots.platform.token)
  await page.getByRole('button', { name: 'Prova e salva' }).click()
  await confirmWithPassword(page)
  await expect(page.getByRole('dialog', { name: 'Conferma che sei tu' })).toBeHidden()
  await expect(page.getByTestId('telegram-bot-state')).toHaveText('Attivo')
  await expect(page.getByTestId('telegram-bot-name')).toHaveText('@feedway_mock_bot')
  expect((await axe(page)).violations).toEqual([])
  await shot(page, 'telegram-piattaforma-impostato', isMobile)

  await page.getByTestId('telegram-bot-remove').click()
  await page
    .getByRole('dialog', { name: 'Togli il bot' })
    .getByTestId('telegram-bot-remove-confirm')
    .click()
  await expect(page.getByTestId('telegram-bot-state')).toHaveText('Da configurare')
})

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  E2E_PASSWORD,
  addDataKey,
  adminQuery,
  newPerson,
  ownAddress,
  signInWithTotp,
} from './support/people.ts'
import { agencyBotFor } from './support/telegram.ts'

// «Collega Telegram» in Profilo e preferenze (plan 08 Task 7). The worker does not run here: the
// test joins the chat itself, as `telegram.poll` does after «Avvia».

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

test('a person links the agency’s bot from the profile, then unlinks it', async ({
  page,
  isMobile,
}) => {
  const bot = await agencyBotFor(1)
  const owner = await newPerson('Lia Collegata', 'owner')
  await signInWithTotp(page.request, owner)
  const org = owner.organizationSlug
  await addDataKey(org)
  // the agency's own bot, as the Owner saves it
  await page.goto(`/${org}/impostazioni/integrazioni/telegram`)
  await page.getByLabel('Token del bot').fill(bot.token)
  await page.getByRole('button', { name: 'Prova e salva' }).click()
  const reauth = page.getByRole('dialog', { name: 'Conferma che sei tu' })
  await reauth.getByLabel('Password').fill(E2E_PASSWORD)
  await reauth.getByRole('button', { name: 'Conferma' }).click()
  await expect(page.getByTestId('telegram-bot-name')).toHaveText(`@${bot.username}`)

  await page.goto('/account')
  const row = page.getByTestId(/^telegram-link-/).filter({ hasText: `@${bot.username}` })
  await expect(row.getByTestId('telegram-link-state')).toHaveText('Non collegato')
  expect((await axe(page)).violations).toEqual([])
  await shot(page, 'telegram-profilo-da-collegare', isMobile)

  await row.getByTestId('telegram-link').click()
  const open = row.getByTestId('telegram-open')
  await expect(open).toHaveAttribute(
    'href',
    new RegExp(`^https://t\\.me/${bot.username}\\?start=[A-Za-z0-9_-]{43}$`),
  )
  await expect(row.getByTestId('telegram-link-state')).toHaveText('In attesa di «Avvia»')
  expect((await axe(page)).violations).toEqual([])
  await shot(page, 'telegram-profilo-in-attesa', isMobile)

  // «Avvia» in Telegram: the chat is joined, the page sees it by itself
  await adminQuery(
    `update telegram_links set chat_id = 4242, linked_at = now(), link_code_hash = null,
            link_code_expires_at = null
      where user_id = $1`,
    [owner.userId],
  )
  await expect(row.getByTestId('telegram-link-state')).toHaveText('Collegato', { timeout: 10_000 })
  expect((await axe(page)).violations).toEqual([])
  await shot(page, 'telegram-profilo-collegato', isMobile)

  await row.getByTestId('telegram-unlink').click()
  await expect(row.getByTestId('telegram-link-state')).toHaveText('Non collegato')
  expect(
    await adminQuery('select 1 from telegram_links where user_id = $1', [owner.userId]),
  ).toHaveLength(0)
})

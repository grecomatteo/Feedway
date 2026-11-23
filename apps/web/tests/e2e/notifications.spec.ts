import AxeBuilder from '@axe-core/playwright'
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { adminQuery, newPerson, ownAddress, signInWithTotp } from './support/people.ts'

// The bell, the notification centre and the person's choices (plan 08 Task 6, screen 05):
// the latest from the bell, every one on their page, the channels in «Profilo e preferenze».

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(async ({ baseURL, page }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
  await ownAddress(page)
})

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()

/** A notification as the dispatcher writes it, with its panel and email deliveries. */
async function notify(organizationId: string, userId: string, minutesAgo: number) {
  const id = randomUUID()
  await adminQuery(
    `insert into notifications (id, organization_id, user_id, event_id, kind, level, payload, created_at)
     values ($1, $2, $3, $4, 'meta.reminder', 'warning', '{"reminder":"app_rejected"}',
             now() - make_interval(mins => $5))`,
    [id, organizationId, userId, randomUUID(), minutesAgo],
  )
  await adminQuery(
    `insert into notification_deliveries (id, organization_id, user_id, notification_id, kind, channel, status, error)
     values ($1, $2, $3, $4, 'meta.reminder', 'panel', 'sent', null),
            ($5, $2, $3, $4, 'meta.reminder', 'email', 'skipped', 'Email non configurata sulla piattaforma')`,
    [randomUUID(), organizationId, userId, id, randomUUID()],
  )
  return id
}

test('the bell opens the latest, a row opens its page and is read, «Segna tutte» empties the dot', async ({
  page,
  isMobile,
}) => {
  const owner = await newPerson('Olga Campanella', 'owner')
  const org = owner.organizationSlug
  await notify(org, owner.userId, 30)
  await notify(org, owner.userId, 5)
  await signInWithTotp(page.request, owner)
  await page.goto(`/${org}`)

  const where = isMobile ? page.getByRole('banner') : page.getByRole('complementary')
  const bell = where.getByRole('button', { name: 'Notifiche, 2 da leggere' })
  await expect(bell).toBeVisible()
  await bell.focus()
  await page.keyboard.press('Enter')
  const panel = page.locator('section[aria-labelledby="notifications-panel-title"]')
  await expect(panel).toBeVisible()
  const rows = panel.locator('[data-notification]')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('Da sistemare su Meta')
  await expect(rows.first()).toContainText("Meta non accetta più l'App ID")
  expect((await axe(page)).violations).toEqual([])

  // a row opens where it is dealt with and is marked as read
  await rows.first().getByRole('button').click()
  await expect(page).toHaveURL(new RegExp(`/${org}/impostazioni/integrazioni/meta$`))
  await expect(where.getByRole('button', { name: 'Notifiche, 1 da leggere' })).toBeVisible()

  await where.getByRole('button', { name: 'Notifiche, 1 da leggere' }).click()
  await page.getByRole('button', { name: 'Segna tutte come lette' }).click()
  await expect(panel.locator('[data-unread]')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Segna tutte come lette' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(where.getByRole('button', { name: 'Notifiche', exact: true })).toBeVisible()
})

test('every notification on its page, with the channels and the filters', async ({ page }) => {
  const owner = await newPerson('Olga Centro', 'owner')
  const org = owner.organizationSlug
  await notify(org, owner.userId, 60)
  const read = await notify(org, owner.userId, 2)
  await adminQuery('update notifications set read_at = now() where id = $1', [read])
  await signInWithTotp(page.request, owner)
  await page.goto(`/${org}/notifiche`)

  await expect(page.getByRole('heading', { level: 1, name: 'Notifiche' })).toBeVisible()
  const rows = page.locator('[data-notification-list] [data-notification]')
  await expect(rows).toHaveCount(2)
  await expect(rows.first().locator('[data-deliveries]')).toHaveText(
    'Email non configurata sulla piattaforma',
  )
  expect((await axe(page)).violations).toEqual([])

  await page
    .getByRole('group', { name: 'Mostra' })
    .getByRole('button', { name: 'Da leggere' })
    .click()
  await expect(rows).toHaveCount(1)
  await page.getByRole('button', { name: 'Segna tutte come lette' }).click()
  await expect(page.getByText('Nessuna notifica da leggere')).toBeVisible()
  expect((await axe(page)).violations).toEqual([])
})

test('the choices: channels per kind, quiet hours, the email that always goes', async ({
  page,
}) => {
  const owner = await newPerson('Olga Scelte', 'owner')
  await signInWithTotp(page.request, owner)
  await page.goto('/account')

  // D-74, D-95 punto 4: on and not to be turned off
  const always = page.locator('[data-always-email]')
  await expect(always).toBeChecked()
  await expect(always).toBeDisabled()

  const kinds = page.locator('[data-notification-kinds]')
  const confirmed = kinds
    .locator('[data-kind-row]')
    .filter({ hasText: 'Post uscito su tutti gli account' })
  await expect(confirmed.getByRole('checkbox', { name: 'Telegram' })).toBeChecked()
  await confirmed.getByRole('checkbox', { name: 'Telegram' }).click()
  await expect(kinds.getByRole('status')).toHaveText('Modifiche salvate.')
  await expect
    .poll(async () =>
      adminQuery<{ channels: string[] }>(
        `select channels from notification_prefs where user_id = $1 and kind = 'post.confirmed'`,
        [owner.userId],
      ),
    )
    .toEqual([{ channels: ['panel'] }])
  await confirmed.getByRole('button', { name: /Torna ai canali predefiniti/ }).click()
  await expect(confirmed.getByRole('checkbox', { name: 'Telegram' })).toBeChecked()

  const settings = page.locator('[data-notification-settings]')
  await settings.getByRole('switch', { name: 'Ore di silenzio' }).click()
  await expect(settings.getByText('Dalle', { exact: true })).toBeVisible()
  await expect
    .poll(async () =>
      adminQuery<{ quiet_start: string }>(
        'select quiet_start from notification_settings where user_id = $1',
        [owner.userId],
      ),
    )
    .toEqual([{ quiet_start: '22:00' }])
  await settings.getByRole('button', { name: 'sabato' }).click()
  await expect(settings.getByRole('button', { name: 'sabato' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  // the digest only on Telegram; the last channel cannot be taken off
  const digestChannels = settings.locator('[data-digest-channels]')
  await digestChannels.getByRole('checkbox', { name: 'Email' }).click()
  await expect
    .poll(async () =>
      adminQuery<{ digest_channels: string[] }>(
        'select digest_channels from notification_settings where user_id = $1',
        [owner.userId],
      ),
    )
    .toEqual([{ digest_channels: ['telegram'] }])
  await expect(digestChannels.getByRole('checkbox', { name: 'Telegram' })).toBeDisabled()
  expect((await axe(page)).violations).toEqual([])
})

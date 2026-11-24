import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createDb } from '@app/infrastructure'
import {
  E2E_PASSWORD,
  adminQuery,
  newPerson,
  ownAddress,
  signInWithTotp,
} from './support/people.ts'

// Piattaforma → Integrazioni (plan 08 Task 9): the worker's beats and the external watch. The
// worker does not run here, so the beats are written by hand; the watch's address points at a
// port nobody listens on, so «Prova» fails the same way every time.

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

/** The beats and the watch are one for the whole platform: the four projects take turns. */
async function oneAtATime(fn: () => Promise<void>) {
  const url = process.env.E2E_ADMIN_URL
  if (!url) throw new Error('e2e database not available')
  const db = createDb(url, { max: 1, applicationName: 'e2e-platform-monitoring' })
  const client = await db.pool.connect()
  try {
    await client.query("select pg_advisory_lock(hashtext('e2e:platform-monitoring'))")
    await fn()
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('e2e:platform-monitoring'))")
    client.release()
    await db.close()
  }
}

const beat = (instance: string, secondsAgo: number, version: string) =>
  adminQuery(
    `insert into system_heartbeats (process, instance, last_beat_at, details)
       values ('worker', $1, now() - make_interval(secs => $2), $3)`,
    [instance, secondsAgo, JSON.stringify({ version, queues: 9 })],
  )

const UNREACHABLE = 'https://127.0.0.1:9/ping/e2e-indirizzo-segreto'

test('the worker’s beats and the external watch, for the platform administrator', async ({
  page,
  isMobile,
}) => {
  // the other projects may hold the turn for a while
  test.setTimeout(120_000)
  const admin = await newPerson('Matteo Piattaforma', 'owner')
  await adminQuery("update users set platform_role = 'admin' where id = $1", [admin.userId])
  await signInWithTotp(page.request, admin)

  await oneAtATime(async () => {
    await adminQuery("delete from system_heartbeats where process = 'worker'")
    await adminQuery("delete from integrations where kind = 'heartbeat'")
    await page.goto('/piattaforma/integrazioni')
    await expect(page.getByTestId('worker-none')).toContainText('Nessun battito ricevuto')
    await expect(page.getByTestId('external-watch-state')).toHaveText('Da configurare')
    await expect(page.getByRole('region', { name: 'Come impostarla' })).toBeVisible()
    expect((await axe(page)).violations).toEqual([])
    await shot(page, 'monitoraggio-vuoto', isMobile)

    // one instance beats, the other stopped five minutes ago
    await beat('feedway-worker-1', 10, '0.14.0')
    await beat('feedway-worker-old', 300, '0.13.2')
    await page.reload()
    const row = (name: string) => page.getByTestId('worker-instance').filter({ hasText: name })
    await expect(row('feedway-worker-1')).toContainText('In funzione')
    await expect(row('feedway-worker-1')).toContainText('versione 0.14.0')
    await expect(row('feedway-worker-old')).toContainText('Fermo')
    // one beating instance is enough to run the jobs
    await expect(page.getByTestId('worker-state')).toHaveText('In funzione')

    // only https
    await page.getByLabel('Indirizzo del controllo').fill('http://hc-ping.com/abc')
    await page.getByRole('button', { name: 'Salva', exact: true }).click()
    const reauth = page.getByRole('dialog', { name: 'Conferma che sei tu' })
    await reauth.getByLabel('Password').fill(E2E_PASSWORD)
    await reauth.getByRole('button', { name: 'Conferma' }).click()
    await expect(page.getByText('L’indirizzo deve iniziare con https://')).toBeVisible()

    await page.getByLabel('Indirizzo del controllo').fill(UNREACHABLE)
    await page.getByRole('button', { name: 'Salva', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Indirizzo salvato' })).toBeVisible()
    await expect(page.getByTestId('external-watch-state')).toHaveText(
      'In attesa della prima chiamata',
    )
    await expect(page.getByTestId('external-watch-last')).toHaveText(
      'Non ancora chiamato: succede entro un minuto',
    )

    await page.getByTestId('external-watch-test').click()
    await expect(page.getByTestId('external-watch-last')).toContainText(
      'Servizio non raggiungibile oggi alle',
    )
    await expect(page.getByTestId('external-watch-state')).toHaveText('Ultima chiamata fallita')
    // the address never comes back, nor sits in the page
    expect(await page.content()).not.toContain('e2e-indirizzo-segreto')
    expect((await axe(page)).violations).toEqual([])
    await shot(page, 'monitoraggio-impostato', isMobile)

    // a call that went well, as the job leaves it
    await adminQuery(
      `update integrations set state = jsonb_build_object(
         'lastAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'ok', true, 'status', 200, 'problem', null)
       where kind = 'heartbeat'`,
    )
    await adminQuery("delete from system_heartbeats where instance = 'feedway-worker-old'")
    await page.reload()
    await expect(page.getByTestId('external-watch-state')).toHaveText('Attiva')
    await expect(page.getByTestId('external-watch-last')).toContainText('Riuscita oggi alle')
    await shot(page, 'monitoraggio-attivo', isMobile)

    await page.getByTestId('external-watch-remove').click()
    const dialog = page.getByRole('dialog', { name: 'Togli la sorveglianza' })
    await dialog.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
    )
    expect((await axe(page)).violations).toEqual([])
    await dialog.getByTestId('external-watch-remove-confirm').click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: 'Sorveglianza tolta' })).toBeVisible()
    await expect(page.getByTestId('external-watch-state')).toHaveText('Da configurare')
    await adminQuery("delete from system_heartbeats where process = 'worker'")
  })
})

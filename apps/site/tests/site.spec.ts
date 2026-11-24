import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const PAGES = [
  '/',
  '/privacy/',
  '/cancellazione-dati/',
  '/termini/',
  '/richiedi-una-demo/',
  '/richiedi-una-demo/inviata/',
]

for (const path of PAGES) {
  test(`${path} has no accessibility violations and no horizontal scroll`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(path)
    await expect(page.locator('h1')).toHaveCount(1)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
    ).toEqual([])
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
}

test('the home page has no accessibility violations with the animations running', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('#pubblicazione').scrollIntoViewIfNeeded()
  await page.locator('footer').scrollIntoViewIfNeeded()
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    // mid-scroll, scrubbed elements are half faded in: contrast is checked in the final state above
    .disableRules(['color-contrast'])
    .analyze()
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
  ).toEqual([])
})

test('every internal link and image of every page resolves', async ({ page, request }) => {
  const seen = new Set<string>()
  for (const path of PAGES) {
    await page.goto(path)
    const urls = await page.evaluate(() => [
      ...[...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? ''),
      ...[...document.querySelectorAll('img[src], source[srcset]')].map(
        (i) => i.getAttribute('src') ?? i.getAttribute('srcset') ?? '',
      ),
    ])
    for (const url of urls) {
      if (!url.startsWith('/') || seen.has(url)) continue
      seen.add(url)
      const res = await request.get(url.replace(/#.*$/, ''))
      expect(res.status(), url).toBe(200)
    }
  }
  expect(seen.size).toBeGreaterThan(5)
})

test('the site sets no cookie and asks no other host', async ({ page, context }) => {
  const hosts = new Set<string>()
  page.on('request', (r) => hosts.add(new URL(r.url()).host))
  for (const path of PAGES) await page.goto(path)
  expect([...hosts]).toEqual(['127.0.0.1:3102'])
  expect(await context.cookies()).toEqual([])
})

test('the privacy notice says how to request deletion and which Meta data Feedway keeps', async ({
  page,
}) => {
  await page.goto('/privacy/')
  await expect(
    page.getByRole('heading', { name: 'Come chiedere la cancellazione dei dati' }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Cancellazione dei dati' }).first()).toHaveAttribute(
    'href',
    '/cancellazione-dati',
  )
  await expect(page.getByText('codice di accesso', { exact: false }).first()).toBeVisible()
  await page.goto('/cancellazione-dati/')
  await expect(page.getByRole('heading', { name: '2. Chiedi la cancellazione' })).toBeVisible()
})

test('every «Richiedi una demo» leads to the form, and nothing offers to sign up or buy', async ({
  page,
}) => {
  await page.goto('/')
  const ctas = page.getByRole('link', { name: 'Richiedi una demo' })
  expect(await ctas.count()).toBeGreaterThanOrEqual(2)
  for (const href of await ctas.evaluateAll((as) => as.map((a) => a.getAttribute('href')))) {
    expect(href).toBe('/richiedi-una-demo')
  }
  await expect(page.getByText(/registrati|iscriviti|acquista|prova gratis/i)).toHaveCount(0)
})

test('the demo form names each wrong field under it', async ({ page }) => {
  await page.goto('/richiedi-una-demo/')
  await page.getByLabel('Email').fill('paola')
  await page.getByRole('button', { name: 'Invia la richiesta' }).click()
  await expect(page.getByText('Scrivilo qui, ci serve per risponderti.')).toHaveCount(2)
  await expect(page.getByText('Controlla l’email')).toBeVisible()
  await expect(page.getByLabel('Nome e cognome')).toBeFocused()
})

test('the demo form shows the confirmation after a send the function accepts', async ({ page }) => {
  await page.route('**/api/richiesta-demo', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  )
  await page.goto('/richiedi-una-demo/')
  await page.getByLabel('Nome e cognome').fill('Paola Rossi')
  await page.getByLabel('Agenzia').fill('Studio Aurora')
  await page.getByLabel('Email').fill('paola@example.com')
  await page.getByRole('button', { name: 'Invia la richiesta' }).click()
  await expect(
    page.getByRole('heading', { name: 'Richiesta inviata, ti scriviamo noi' }),
  ).toBeVisible()
  await expect(page.locator('#inviata')).toBeFocused()
})

test('the publication outcomes show four confirmed and one with a problem', async ({ page }) => {
  await page.goto('/')
  await page.locator('#pubblicazione').scrollIntoViewIfNeeded()
  await expect(page.getByText('4 confermate · 1 con problema')).toBeVisible()
  await expect(page.locator('[data-status="failed"]')).toHaveCount(1)
  await expect(page.locator('[data-status="confirmed"]')).toHaveCount(8)
})

test('planned features carry the «In arrivo» mark, shipped ones do not', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('tabpanel')).toContainText('In arrivo')
  await page.getByRole('tab', { name: 'Pubblica e verifica' }).click()
  await expect(page.getByRole('tabpanel')).toContainText('Feed, caroselli, reel e storie')
  await expect(page.getByRole('tabpanel')).not.toContainText('In arrivo')
  await expect(page.locator('#cliente .soon-mark')).toHaveCount(4)
  await page.getByRole('tab', { name: 'Resta avvisato' }).click()
  await expect(page.getByRole('heading', { name: /lo sai subito/ })).not.toContainText('In arrivo')
  await expect(page.getByRole('tabpanel').locator('.soon-mark')).toHaveCount(1)
  await page.getByRole('tab', { name: 'Misura' }).click()
  await expect(page.getByRole('heading', { name: /Il report del mese/ })).toContainText('In arrivo')
})

test('the product tabs move with the arrow keys', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Pianifica' }).click()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Produci' })).toBeFocused()
  await expect(page.getByRole('tab', { name: 'Produci' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('End')
  await expect(page.getByRole('tab', { name: 'Misura' })).toBeFocused()
  await expect(page.getByRole('tabpanel')).toContainText('Il report del mese')
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('the home page is complete without the animations', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Tutta la tua agenzia, in un solo posto.',
    )
    await expect(page.locator('.stage-fallback')).toBeVisible()
    await expect(page.getByText('4 confermate · 1 con problema')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Domande frequenti' })).toBeVisible()
    await expect(page.getByRole('tabpanel')).toHaveCount(6)
    await expect(page.getByText('Le attività dell’agenzia, accanto ai post')).toBeVisible()
  })

  test('an invalid request says what to fix, not that the service is down', async ({ page }) => {
    await page.goto('/richiedi-una-demo/da-correggere/')
    await expect(page.getByRole('alert')).toContainText('Controlla nome, agenzia ed email')
    await page.goto('/richiedi-una-demo/non-inviata/')
    await expect(page.getByRole('alert')).toContainText('Riprova tra qualche minuto')
  })
})

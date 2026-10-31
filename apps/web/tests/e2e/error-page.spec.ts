import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(({ baseURL }) => {
  test.skip(!baseURL, 'base URL not available')
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

test('a page that does not exist shows the branded 404 and leads home', async ({ page }) => {
  const response = await page.goto('/pagina/che-non-esiste')
  expect(response?.status()).toBe(404)
  expect(response?.headers()['content-type']).toContain('text/html')
  await expect(page.getByRole('heading', { level: 1, name: 'Pagina non trovata' })).toBeVisible()
  await expect(page.getByText('Feedway').first()).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/Page not found|stack|at /)
  await expect(page.getByTestId('request-id')).toHaveCount(0)

  await page.getByRole('button', { name: 'Torna alla home' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Feedway' })).toBeVisible()
})

test('the 404 page has no accessibility violations', async ({ page }) => {
  await page.goto('/pagina/che-non-esiste')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations).toEqual([])
})

test('a failure shows a generic page with the request id, never the detail', async ({ page }) => {
  const response = await page.goto('/__test/fail')
  expect(response?.status()).toBe(500)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Qualcosa è andato storto' }),
  ).toBeVisible()
  const shown = (await page.getByTestId('request-id').textContent())?.trim() ?? ''
  expect(shown).toMatch(UUID)
  // the code support asks for is the one in the logs of this request
  expect(shown).toBe(response?.headers()['x-request-id'])
  await expect(page.locator('body')).not.toContainText(/boom|secret|Error:/)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations).toEqual([])
})

test('the error page fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.goto('/pagina/che-non-esiste')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  const box = await page.getByRole('button', { name: 'Torna alla home' }).boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})

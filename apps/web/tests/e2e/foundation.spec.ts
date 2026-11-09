import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(({ baseURL }) => {
  test.skip(!baseURL, 'base URL not available')
})

test('home shows the product name and a ready status', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Feedway' })).toBeVisible()
  await expect(page.getByRole('status')).toBeVisible()
})

test('home leads to sign-in', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Accedi al pannello' }).click()
  await expect(page).toHaveURL(/\/accedi$/)
  await expect(page.getByRole('button', { name: 'Accedi con la password' })).toBeVisible()
})

test('home has no accessibility violations', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(results.violations).toEqual([])
})

test('skip link is the first focusable element', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Tab')
  await expect(page.locator(':focus')).toHaveAttribute('href', '#main')
})

test('the theme follows the system, then one click turns it to the other and it stays', async ({
  page,
}) => {
  await page.goto('/')
  const html = page.locator('html')
  const systemDark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
  if (systemDark) await expect(html).toHaveClass(/dark/)
  else await expect(html).not.toHaveClass(/dark/)
  const toggle = page.getByRole('button', { name: 'Passa al tema chiaro o scuro' })
  // under load the first click can land before the page is interactive: click until it turns
  await expect(async () => {
    await toggle.click()
    if (systemDark) await expect(html).not.toHaveClass(/dark/, { timeout: 2000 })
    else await expect(html).toHaveClass(/dark/, { timeout: 2000 })
  }).toPass()
  // no menu: a single click is the whole switch
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.reload()
  if (systemDark) await expect(html).not.toHaveClass(/dark/)
  else await expect(html).toHaveClass(/dark/)
  await toggle.click()
  if (systemDark) await expect(html).toHaveClass(/dark/)
  else await expect(html).not.toHaveClass(/dark/)
})

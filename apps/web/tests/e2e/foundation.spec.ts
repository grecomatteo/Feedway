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

test('theme can be switched and persists after a reload', async ({ page }) => {
  await page.goto('/')
  // under load the first click can land before the page is interactive: open until it shows
  await expect(async () => {
    await page.getByRole('button', { name: 'Tema' }).click()
    await expect(page.getByRole('menuitemcheckbox', { name: 'Scuro' })).toBeVisible({
      timeout: 1000,
    })
  }).toPass()
  await page.getByRole('menuitemcheckbox', { name: 'Scuro' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByRole('button', { name: 'Tema' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Chiaro' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})

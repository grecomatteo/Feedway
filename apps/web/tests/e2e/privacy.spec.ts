import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { runDataExportJob } from './support/jobs.ts'
import { newMember, signIn } from './support/people.ts'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(({ baseURL }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
})

test('download my data shows progress and then the file', async ({ page }) => {
  const person = await newMember('Chiara Russo')
  await signIn(page.request, person)
  await page.goto('/account/privacy')
  const section = page.getByRole('region', { name: 'I tuoi dati' })
  await section.getByRole('button', { name: 'Scarica i miei dati' }).click()

  const status = section.getByRole('status')
  await expect(status).toHaveText(/Stiamo preparando il file/)
  const steps = section.getByRole('list', { name: 'Avanzamento' })
  await expect(steps.locator('[aria-current="step"]')).toHaveText('In preparazione')
  // no second request while one is being prepared
  await expect(section.getByRole('button', { name: /Scarica i miei dati|nuovo file/ })).toHaveCount(
    0,
  )

  const axe = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(axe.violations).toEqual([])

  // the person may leave: the state is there when they come back
  await page.goto('/account')
  await runDataExportJob(person.userId)
  await page.goto('/account/privacy')
  await expect(status).toHaveText('Il file è pronto.')
  await expect(steps.locator('[aria-current="step"]')).toHaveText('Pronto')
  await expect(section.getByText(/Scaricabile fino al/)).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    section.getByRole('link', { name: 'Scarica il file' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^dati-personali-\d{4}-\d{2}-\d{2}\.zip$/)
})

test('the page updates by itself when the file is ready', async ({ page }) => {
  const person = await newMember('Paolo Conti')
  await signIn(page.request, person)
  await page.goto('/account/privacy')
  const section = page.getByRole('region', { name: 'I tuoi dati' })
  await section.getByRole('button', { name: 'Scarica i miei dati' }).click()
  await expect(section.getByRole('status')).toHaveText(/Stiamo preparando il file/)
  await runDataExportJob(person.userId)
  // polled every 3 seconds
  await expect(section.getByRole('status')).toHaveText('Il file è pronto.', { timeout: 10_000 })
})

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { imageFixture } from '@app/infrastructure/testing'
import { newMember, signIn } from './support/people.ts'

test.use({ baseURL: process.env.E2E_BASE_URL })

test.beforeEach(({ baseURL }) => {
  test.skip(!baseURL || !process.env.E2E_DATABASE_URL, 'e2e server not available')
})

/** The photo shown next to "Il mio account" in the header, once it has loaded. */
async function headerPhoto(page: Page, userId: string) {
  const photo = page
    .getByRole('navigation')
    .locator(`img[src^="/api/v1/users/${userId}/avatar/64?v="]`)
  await expect(photo).toBeVisible()
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(64)
  return photo
}

test('photo chosen from file, cropped with keyboard, shown in the header', async ({ page }) => {
  const person = await newMember()
  await signIn(page.request, person)
  await page.goto('/account')
  const section = page.getByRole('region', { name: 'Foto profilo' })
  await expect(section.getByRole('button', { name: 'Scegli foto' })).toBeEnabled()
  await section.getByTestId('avatar-file').setInputFiles({
    name: 'vacanze.jpg',
    mimeType: 'image/jpeg',
    buffer: await imageFixture('photo.jpg'),
  })

  const dialog = page.getByRole('dialog', { name: 'Ritaglia la foto' })
  await expect(dialog).toBeVisible()
  const area = dialog.getByRole('slider', { name: 'Parte della foto da usare' })
  // 600 × 400: the largest square, in the middle
  await expect(area).toHaveAttribute('aria-valuetext', /Quadrato di 400 pixel, a 100 da sinistra/)
  await area.focus()
  await page.keyboard.press('+')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowUp')
  await expect(area).toHaveAttribute('aria-valuenow', '360')
  await expect(area).toHaveAttribute('aria-valuetext', /a 102 da sinistra e 2 dall'alto/)
  await dialog.getByRole('button', { name: 'Rimpicciolisci' }).click()
  await expect(area).toHaveAttribute('aria-valuenow', '400')

  const axe = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(axe.violations).toEqual([])

  await dialog.getByRole('button', { name: 'Usa questa foto' }).click()
  await expect(dialog).toBeHidden()
  await expect(section.getByRole('status')).toHaveText('Foto profilo salvata.')
  await headerPhoto(page, person.userId)

  // back to the initials
  await section.getByRole('button', { name: 'Togli la foto' }).click()
  await expect(section.getByRole('status')).toHaveText(/Foto tolta/)
  await expect(page.getByRole('navigation').locator('img')).toHaveCount(0)
})

test('photo dropped on the uploader works too', async ({ page }) => {
  const person = await newMember()
  await signIn(page.request, person)
  await page.goto('/account')
  const drop = page.getByTestId('avatar-drop')
  await expect(page.getByRole('button', { name: 'Scegli foto' })).toBeEnabled()
  const bytes = [...(await imageFixture('photo.png'))]
  const transfer = await page.evaluateHandle((data) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(data)], 'trascinata.png', { type: 'image/png' }))
    return dt
  }, bytes)
  await drop.dispatchEvent('dragover', { dataTransfer: transfer })
  await expect(drop).toContainText('Rilascia qui')
  await drop.dispatchEvent('drop', { dataTransfer: transfer })
  const dialog = page.getByRole('dialog', { name: 'Ritaglia la foto' })
  await expect(dialog.getByTestId('avatar-preview-large')).toBeVisible()
  await dialog.getByRole('button', { name: 'Usa questa foto' }).click()
  await headerPhoto(page, person.userId)
})

test('a file that is not a photo is refused with the reason', async ({ page }) => {
  const person = await newMember()
  await signIn(page.request, person)
  await page.goto('/account')
  const section = page.getByRole('region', { name: 'Foto profilo' })
  await expect(section.getByRole('button', { name: 'Scegli foto' })).toBeEnabled()
  // the name says JPEG, the bytes say GIF: the server decides from the bytes
  await section.getByTestId('avatar-file').setInputFiles({
    name: 'finta.jpg',
    mimeType: 'image/jpeg',
    buffer: await imageFixture('anim.gif'),
  })
  await expect(section.getByRole('alert')).toHaveText('Usa una foto JPEG, PNG, WebP o HEIC.')
  await section.getByTestId('avatar-file').setInputFiles({
    name: 'enorme.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 1),
  })
  await expect(section.getByRole('alert')).toHaveText(/al massimo 5 MB/)
})

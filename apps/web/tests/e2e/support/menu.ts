import { expect, type Page } from '@playwright/test'

/**
 * Opens the user menu: the person's row at the bottom of the sidebar, or their photo at the top
 * on a phone. A click before the page runs in the browser would be lost: click until it opens.
 */
export async function openUserMenu(page: Page, name: string) {
  const trigger = page.getByRole('button', { name: new RegExp(name) })
  const menu = page.getByRole('menu', { name: 'Il tuo account' })
  await expect(async () => {
    if (!(await menu.isVisible())) await trigger.click()
    await expect(menu).toBeVisible({ timeout: 2000 })
  }).toPass()
  return menu
}

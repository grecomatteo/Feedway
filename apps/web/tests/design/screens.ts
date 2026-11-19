import type { Page } from '@playwright/test'
import type { DesignSample } from '../e2e/support/design-sample.ts'

/**
 * The screens of the references (design/esplorazioni/2026-11-19-nuova-direzione/schermate) that the
 * code already draws, with the page and the state each one shows. Every task of the redesign adds
 * its screens here (plan, «Come si prova la fedeltà»).
 */
export interface Screen {
  /** the reference's file name without `.png`, the same in `computer/` and `telefono/` */
  id: string
  path: (s: DesignSample) => string
  /** what to do once the page is ready: open a menu, fill a field… */
  prepare?: (page: Page, s: DesignSample) => Promise<void>
  /** only on a computer (00-sistema has no phone version) */
  computerOnly?: boolean
}

/** Opens a menu of the shell: the client selector or the person's menu, on either size. */
async function openShell(page: Page, which: 'selector' | 'person') {
  const phone = (page.viewportSize()?.width ?? 1440) < 768
  const trigger =
    which === 'selector'
      ? page.getByRole('button', { name: /^Contesto:/ }).locator('visible=true')
      : phone
        ? page.getByRole('button', { name: /^Tu, menu di/ })
        : page.getByRole('button', { name: /Giulia Ferri/ }).locator('visible=true')
  await trigger.click()
  await page
    .getByRole(which === 'selector' ? 'listbox' : 'menu')
    .locator('visible=true')
    .first()
    .waitFor()
  // the pointer leaves the menu, so no row shows its hover, and the opening animation ends
  await page.mouse.move(0, 0)
  await page.waitForTimeout(300)
}

export const SCREENS: Screen[] = [
  { id: '00-sistema', path: () => '/__test/sistema', computerOnly: true },
  // the shell (Task R2): the pages inside it are redrawn by their own tasks
  { id: '02-oggi', path: (s) => `/${s.org}` },
  {
    id: '04-selettore-del-cliente',
    path: (s) => `/${s.org}`,
    prepare: (p) => openShell(p, 'selector'),
  },
  { id: '06-menu-utente', path: (s) => `/${s.org}`, prepare: (p) => openShell(p, 'person') },
  { id: '14-clienti', path: (s) => `/${s.org}/spazi` },
]

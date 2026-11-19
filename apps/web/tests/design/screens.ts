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

export const SCREENS: Screen[] = [
  { id: '00-sistema', path: () => '/__test/sistema', computerOnly: true },
]

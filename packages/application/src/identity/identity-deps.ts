import type { Auth } from '../ports/auth.js'
import type { Clock } from '../ports/clock.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { KeyRing } from '../ports/key-ring.js'
import type { TokenService } from '../ports/token-service.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

/** zxcvbn-style score (0–4) of a password, given words the person would pick (name, email). */
export type PasswordStrength = (password: string, userInputs: string[]) => number

/**
 * What the identity use cases need. Fields arrive with the tasks that use them (the plan lists
 * `hasher`, `rateLimiter` and `require2fa` too: the routes and Task 13 add them).
 */
export interface IdentityDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  auth: Auth
  tokens: TokenService
  keyRing: KeyRing
  passwordStrength: PasswordStrength
  config: {
    bootstrapOwnerEmail: string | null
    bootstrapOrganizationName: string
    /** Origin of the panel, `https://…` */
    panelUrl: string
  }
}

/** The page that opens an activation link (bootstrap, invite, new agency owner). */
export const ACTIVATION_PAGE_PATH = '/attiva/'

export const activationUrl = (panelUrl: string, token: string): string =>
  new URL(`${ACTIVATION_PAGE_PATH}${encodeURIComponent(token)}`, panelUrl).toString()

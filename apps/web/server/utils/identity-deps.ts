import type { IdentityDeps, InviteDeps, PlatformMailDeps } from '@app/application'
import { PRODUCT_NAME } from '@app/config'
import { passwordStrength } from '@app/infrastructure'
import type { Deps } from './deps'

export function identityDeps(deps: Deps): IdentityDeps {
  return {
    uow: deps.uow,
    clock: deps.clock,
    ids: deps.ids,
    auth: deps.auth,
    tokens: deps.tokens,
    keyRing: deps.keyRing,
    passwordStrength,
    rateLimiter: deps.rateLimiter,
    config: {
      bootstrapOwnerEmail: deps.config.bootstrapOwnerEmail,
      bootstrapOrganizationName: deps.config.bootstrapOrganizationName,
      require2fa: deps.config.require2fa,
      panelUrl: deps.config.panelUrl.toString(),
    },
  }
}

/** Inviting also writes the email: the link goes only to the invited mailbox. */
export function inviteDeps(deps: Deps): InviteDeps {
  return {
    ...identityDeps(deps),
    mailer: deps.mailer,
    translate: deps.translate,
    logger: deps.logger,
    productName: PRODUCT_NAME,
    defaultTimezone: deps.config.defaultTimezone,
    signedTokens: deps.signedTokens,
  }
}

/** The system email: its settings, the mailer that tries them, the test email's texts. */
export function platformMailDeps(deps: Deps): PlatformMailDeps {
  return {
    uow: deps.uow,
    integrations: deps.integrations,
    clock: deps.clock,
    rateLimiter: deps.rateLimiter,
    mailer: deps.mailer,
    translate: deps.translate,
    logger: deps.logger,
    panelUrl: deps.config.panelUrl,
    productName: PRODUCT_NAME,
  }
}

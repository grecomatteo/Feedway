import type { IdentityDeps, InviteDeps } from '@app/application'
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
  }
}

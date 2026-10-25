import type { IdentityDeps } from '@app/application'
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

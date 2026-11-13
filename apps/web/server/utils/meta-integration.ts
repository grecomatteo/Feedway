import type { MetaIntegrationDeps, MetaIntegrationView } from '@app/application'
import type { Deps } from './deps'

/** The agency's Meta app: its settings, and the connector that tries them with Meta. */
export function metaIntegrationDeps(deps: Deps): MetaIntegrationDeps {
  return { uow: deps.uow, clock: deps.clock, integrations: deps.integrations, meta: deps.meta }
}

/** What leaves for the panel: dates as ISO strings, no secret (the row being there says it is set). */
export function metaIntegrationDto(view: MetaIntegrationView) {
  return {
    appId: view.appId,
    configId: view.configId,
    businessId: view.businessId,
    dataUseCheckupDueOn: view.dataUseCheckupDueOn,
    verifiedAt: view.verifiedAt?.toISOString() ?? null,
    rejectedAt: view.rejectedAt?.toISOString() ?? null,
    updatedAt: view.updatedAt.toISOString(),
  }
}

/** Each save and each test is a call to Meta under the agency's app: a few a minute are plenty. */
export const META_INTEGRATION_RATE_LIMIT = { name: 'meta-integration', limit: 10, windowMs: 60_000 }

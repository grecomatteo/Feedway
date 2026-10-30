import type { IntegrationStore, MailSettingsSource } from '../ports/integration-store.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

export interface MailSettingsDeps {
  uow: UnitOfWork
  integrations: IntegrationStore
}

/**
 * The platform's SMTP settings, read in the system scope at every send: the worker sends with
 * no user, and the platform rows are visible only there. Agencies configure nothing (ADR 017).
 */
export function createMailSettings(deps: MailSettingsDeps): MailSettingsSource {
  const { uow, integrations } = deps
  return {
    isConfigured: () =>
      uow.runAsSystem(
        'mail: is the platform SMTP set',
        async (tx) => (await integrations.getPlatform(tx, 'smtp')) !== null,
      ),
    credentials: () =>
      uow.runAsSystem('mail: platform SMTP for a send', (tx) =>
        integrations.platformCredentials(tx, 'smtp'),
      ),
  }
}

import { RETENTION, storedPrivacySettings, type OrgActor } from '@app/domain'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { FIRST_ORGANIZATION_SETTING } from './activation.js'

/** A cookie the panel sets: the notice lists these, read from the code that sets them. */
export interface PanelCookie {
  name: string
  purpose: 'session' | 'second_factor' | 'passkey' | 'device' | 'theme'
  /** How long it stays; null: until the browser is closed. */
  maxAgeSeconds: number | null
}

export interface PrivacyNoticeDeps {
  uow: UnitOfWork
  cookies: readonly PanelCookie[]
}

export interface PrivacyNotice {
  /** null on a platform not activated yet */
  organizationName: string | null
  /** null until the Owner fills them in (Impostazioni) */
  controllerName: string | null
  contactEmail: string | null
  extraText: string | null
  retention: typeof RETENTION
  cookies: readonly PanelCookie[]
}

/**
 * The privacy notice (spec §15.7). Without an agency it is the public page, reachable without
 * signing in: the agency created with the platform is the controller of the team's data in
 * 1.0. With one, the agency's own notice, for its members. Retention periods and cookies come
 * from the code, so the notice cannot say anything different.
 */
export async function getPrivacyNotice(
  deps: PrivacyNoticeDeps,
  input: { organization: OrgActor | null },
): Promise<PrivacyNotice> {
  const actor = input.organization
  const agency =
    actor === null
      ? // the public page reads one agency, the first: its name and its controller data only
        await deps.uow.runAsSystem('privacy notice of the first agency', async (tx) => {
          const id = await tx.platformSettings.get(FIRST_ORGANIZATION_SETTING)
          return typeof id === 'string' ? tx.organizations.findById(id) : null
        })
      : await deps.uow.run({ organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
          tx.organizations.findById(actor.organizationId),
        )
  const privacy = agency ? storedPrivacySettings(agency.settings) : null
  return {
    organizationName: agency?.name ?? null,
    controllerName: privacy?.controllerName ?? null,
    contactEmail: privacy?.contactEmail ?? null,
    extraText: privacy?.extraText ?? null,
    retention: RETENTION,
    cookies: deps.cookies,
  }
}

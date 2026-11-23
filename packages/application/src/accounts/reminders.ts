import {
  can,
  DomainError,
  metaReminders,
  type MetaReminder,
  type OrgActor,
  type OutboxPayload,
} from '@app/domain'
import { assertActiveOrganization } from '../workspaces/index.js'
import { calendarDay } from '../mail/index.js'
import type { Clock } from '../ports/clock.js'
import type { IntegrationStore } from '../ports/integration-store.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

// The Meta reminders of «Account social» (§8.4, RF-21, plan 03 Task 11), read when the list is
// opened: nothing is stored, so stage 8's notifications can read the same state.

export interface MetaRemindersDeps {
  uow: UnitOfWork
  clock: Clock
  integrations: Pick<IntegrationStore, 'get'>
  /** The Graph API version in use and its retirement date (YYYY-MM-DD), from the config. */
  graph: { version: string; sunset: string }
  /** The panel's time zone: the days are counted on its calendar. */
  timeZone: string
}

const cannotManage = () =>
  new DomainError('FORBIDDEN', 'Solo Owner e Admin vedono i promemoria di Meta')

/** Owner and Admin (`accounts.manage`): what needs doing on Meta, platform first. */
export async function listMetaReminders(
  deps: MetaRemindersDeps,
  actor: OrgActor,
): Promise<MetaReminder[]> {
  const { organizationId, userId } = actor
  if (!can(actor, 'accounts.manage', { organizationId })) throw cannotManage()
  const now = deps.clock.now()
  return deps.uow.run({ organizationId, userId }, async (tx) => {
    const membership = await tx.orgMembers.find(organizationId, userId)
    if (
      membership?.status !== 'active' ||
      !can({ ...actor, orgRole: membership.role }, 'accounts.manage', { organizationId })
    )
      throw cannotManage()
    await assertActiveOrganization(tx, organizationId)
    return (await readMetaReminders(tx, deps, organizationId, now)).reminders
  })
}

/** What the reminders are computed from: the same for the panel and `accounts.daily`. */
export type MetaReminderSources = Pick<MetaRemindersDeps, 'integrations' | 'graph' | 'timeZone'>

/** The agency's reminders now, in its scope; `appRejectedAt` keys the refusal's event. */
export async function readMetaReminders(
  tx: Tx,
  sources: MetaReminderSources,
  organizationId: string,
  now: Date,
): Promise<{ reminders: MetaReminder[]; appRejectedAt: Date | null }> {
  const integration = await sources.integrations.get(tx, organizationId, 'meta')
  const appRejectedAt = integration?.rejectedAt ?? null
  const reminders = metaReminders({
    today: calendarDay(now, sources.timeZone),
    now,
    graphVersion: sources.graph.version,
    graphVersionSunset: sources.graph.sunset,
    dataUseCheckupDueOn: integration?.config.dataUseCheckupDueOn ?? null,
    appRejected: appRejectedAt !== null,
    connections: await tx.connections.list(organizationId),
  })
  return { reminders, appRejectedAt }
}

/** A `meta.reminder` for the outbox: ids, codes and dates only (plan 07 «Eventi»). */
export interface MetaReminderEvent {
  payload: OutboxPayload
  /** once per reminder and due date (plan 08 Task 4) */
  dedupeKey: string
}

/**
 * The event of a reminder, written by `accounts.daily` (plan 08 Task 4). The reminders are
 * computed again every day, so each one is keyed by what it is about and when it is due: the same
 * reminder the next day writes nothing, a new due date (a renewed token, another Graph version, a
 * new checkup date, a new refusal) writes again. A revoked access is not reminded here:
 * `account.token_invalid` told it when the health check found it.
 */
export function metaReminderEvent(
  organizationId: string,
  reminder: MetaReminder,
  appRejectedAt: Date | null,
): MetaReminderEvent | null {
  switch (reminder.kind) {
    case 'app_rejected':
      if (appRejectedAt === null) return null
      return {
        payload: { reminder: reminder.kind },
        dedupeKey: `${organizationId}:app_rejected:${appRejectedAt.toISOString()}`,
      }
    case 'graph_version_sunset':
      return {
        payload: {
          reminder: reminder.kind,
          version: reminder.version,
          dueOn: reminder.dueOn,
          daysLeft: reminder.daysLeft,
        },
        dedupeKey: `${organizationId}:graph_version_sunset:${reminder.dueOn}`,
      }
    case 'data_use_checkup':
      return {
        payload: { reminder: reminder.kind, dueOn: reminder.dueOn, daysLeft: reminder.daysLeft },
        dedupeKey: `${organizationId}:data_use_checkup:${reminder.dueOn}`,
      }
    case 'token_expiring': {
      const expiresAt = reminder.expiresAt.toISOString()
      return {
        payload: { reminder: reminder.kind, connectionId: reminder.connectionId, expiresAt },
        dedupeKey: `${reminder.connectionId}:token_expiring:${expiresAt}`,
      }
    }
    case 'access_revoked':
      return null
  }
}

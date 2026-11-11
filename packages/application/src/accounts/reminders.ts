import { can, DomainError, metaReminders, type MetaReminder, type OrgActor } from '@app/domain'
import { assertActiveOrganization } from '../workspaces/index.js'
import type { Clock } from '../ports/clock.js'
import type { IntegrationStore } from '../ports/integration-store.js'
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

const calendarDay = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)

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
    const integration = await deps.integrations.get(tx, organizationId, 'meta')
    return metaReminders({
      today: calendarDay(now, deps.timeZone),
      now,
      graphVersion: deps.graph.version,
      graphVersionSunset: deps.graph.sunset,
      dataUseCheckupDueOn: integration?.config.dataUseCheckupDueOn ?? null,
      connections: await tx.connections.list(organizationId),
    })
  })
}

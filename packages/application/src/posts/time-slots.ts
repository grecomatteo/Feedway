import {
  DomainError,
  NEXT_FREE_SLOT_HORIZON_DAYS,
  TIME_SLOTS_MAX,
  addDays,
  weekday,
  zonedToInstant,
  nextFreeSlot,
  storedTimeZone,
  validateTimeSlots,
  type OrgActor,
  type TimeSlot,
} from '@app/domain'
import type { Clock } from '../ports/clock.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { openContentSettings, recordContentSetting } from './content-settings.js'

// The usual times of a client (spec §11.6, plan 09 Task 9, Scelta 6): every member of the
// workspace reads them and asks for the next free one (the editor), only who manages the
// client's content changes them (`workspace.content_settings.manage`, Manager and above). The
// times are of the agency's zone (D-58), as the calendar's days.

export interface TimeSlotsDto {
  items: TimeSlot[]
}

export interface NextFreeSlotDto {
  /** null: no slots, or every one taken for the months ahead */
  slot: { at: string; localDate: string; localTime: string } | null
}

const DAY_MS = 86_400_000

export async function listTimeSlots(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string },
): Promise<TimeSlotsDto> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { scope } = await openContentSettings(tx, actor, input.workspaceId, { write: false })
      return { items: await tx.timeSlots.list(scope) }
    },
  )
}

/** The slots become the list given (the section saves it whole); the same list writes nothing. */
export async function replaceTimeSlots(
  deps: { uow: UnitOfWork; ids: IdGenerator },
  actor: OrgActor,
  input: { workspaceId: string; slots: readonly { weekday: number; localTime: string }[] },
  request: { ip: string | null } = { ip: null },
): Promise<TimeSlotsDto> {
  const checked = validateTimeSlots(input.slots)
  if (!checked.ok)
    throw new DomainError(
      'VALIDATION',
      checked.reason === 'too_many'
        ? `Un cliente può avere al massimo ${String(TIME_SLOTS_MAX)} fasce orarie`
        : 'Ogni fascia ha un giorno della settimana e un orario come 18:30',
      { field: 'slots', ...(checked.index === undefined ? {} : { index: checked.index }) },
    )
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope } = await openContentSettings(tx, actor, input.workspaceId, {
        write: true,
      })
      const slots = checked.value.map((s) => ({ ...s, id: deps.ids.newId() }))
      if (await tx.timeSlots.replace(scope, slots))
        await recordContentSetting(
          tx,
          current,
          scope,
          'time_slots',
          scope.workspaceId,
          'updated',
          request.ip,
        )
      return { items: checked.value }
    },
  )
}

/**
 * «Prossima fascia libera» (§11.6): the first slot after `after` (now, or later when given) at
 * which the client has no scheduled post at that minute. Reading it asks only to see the client.
 */
export async function findNextFreeSlot(
  deps: { uow: UnitOfWork; clock: Clock },
  actor: OrgActor,
  input: { workspaceId: string; after?: Date },
): Promise<NextFreeSlotDto> {
  const now = deps.clock.now()
  const after = input.after && input.after > now ? input.after : now
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { scope } = await openContentSettings(tx, actor, input.workspaceId, { write: false })
      const slots = await tx.timeSlots.list(scope)
      if (slots.length === 0) return { slot: null }
      const organization = await tx.organizations.findById(scope.organizationId)
      const timeZone = storedTimeZone(organization?.settings ?? {})
      // a day more than the slots look at, for the hours a day of the change adds
      const until = new Date(after.getTime() + (NEXT_FREE_SLOT_HORIZON_DAYS + 1) * DAY_MS)
      const taken = await tx.timeSlots.scheduledAt(scope, after, until)
      const slot = nextFreeSlot(slots, taken, after, timeZone)
      return {
        slot: slot && {
          at: slot.instant.toISOString(),
          localDate: slot.localDate,
          localTime: slot.localTime,
        },
      }
    },
  )
}

/**
 * The first free slot of the client on that day of the agency's zone, after `now` (public, for
 * the plan's «Prepara», §11.12): its local time, or null when the day has none free.
 */
export async function freeSlotOn(
  tx: Tx,
  scope: { organizationId: string; workspaceId: string },
  localDate: string,
  timeZone: string,
  now: Date,
): Promise<string | null> {
  const slots = (await tx.timeSlots.list(scope)).filter((s) => s.weekday === weekday(localDate))
  if (slots.length === 0) return null
  const start = zonedToInstant(localDate, '00:00', timeZone).instant
  const end = zonedToInstant(addDays(localDate, 1), '00:00', timeZone).instant
  const after = new Date(Math.max(start.getTime() - 60_000, now.getTime()))
  if (after >= end) return null
  const slot = nextFreeSlot(
    slots,
    await tx.timeSlots.scheduledAt(scope, after, end),
    after,
    timeZone,
  )
  return slot && slot.localDate === localDate ? slot.localTime : null
}

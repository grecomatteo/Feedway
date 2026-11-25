import {
  DomainError,
  PLAN_ITEM_TYPES,
  can,
  daysBetween,
  dueNotificationAt,
  isLocalDate,
  isModuleEnabled,
  planItemState,
  planNote,
  planTitle,
  referenceInstant,
  storedTimeZone,
  type OrgActor,
  type Permission,
  type PlanItemState,
  type PlanItemType,
  type PlanPostFacts,
} from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { Clock } from '../ports/clock.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { PlanItemRecord, PlanScope } from '../ports/plan.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { createDraft, freeSlotOn, getStatuses, isPostOf } from '../posts/index.js'
import { assertActiveOrganization, currentActor, workspaceNotFound } from '../workspaces/index.js'

// The editorial plan's use cases (spec §11.12, plan 09 Task 6). Who sees the client reads the
// plan, note included (`plan.view`, Scelta 11); Publisher and above write it (`plan.edit`);
// Editor and above prepare a post from it (`plan.prepare`). With the module off for the agency
// (P2) every route answers «not found». The plan reads its posts only through the public
// functions of `posts`, never the other way round.

export interface PlanItemDto {
  id: string
  workspaceId: string
  /** `YYYY-MM-DD` in the agency's zone */
  localDate: string
  /** `HH:MM`; null: the whole day */
  localTime: string | null
  type: PlanItemType
  title: string
  /** for who prepares it: only here, never in the calendar or anywhere else */
  note: string
  /** the post that prepares it; null while to prepare (a cancelled post gives it back) */
  postId: string | null
  state: PlanItemState
  /** the instant «In ritardo» and «Mancano meno di 36 ore» count from (rule 2) */
  dueAt: string
  /** when it turns «due soon» and its notification goes out: the panel counts from here */
  dueSoonAt: string
  version: number
}

export interface PlanDeps {
  uow: UnitOfWork
  clock: Clock
}

/** As the calendar: one month's grid at most. */
export const PLAN_RANGE_MAX_DAYS = 42

export const planItemNotFound = () =>
  new DomainError('NOT_FOUND', 'Contenuto del piano non trovato')

const versionConflict = () =>
  new DomainError(
    'CONFLICT',
    'Il contenuto è stato cambiato da un’altra persona: ricarica per vedere la versione nuova',
    { reason: 'plan_item_version_conflict' },
  )

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const FORBIDDEN: Partial<Record<Permission, string>> = {
  'plan.edit': 'Il piano di questo cliente lo scrive chi può programmare i suoi post',
  'plan.prepare': 'Non puoi preparare i post di questo cliente',
}

/**
 * The client of the request, for who sees its plan, with the agency's zone; the module off,
 * or a client not seen, is «not found». A write needs the agency active and the client not
 * archived, and waits for an archiving under way (as the posts do).
 */
async function openPlan(
  tx: Tx,
  actor: OrgActor,
  workspaceId: string,
  opts: { need: 'plan.view' | 'plan.edit' | 'plan.prepare'; write: boolean },
): Promise<{ current: OrgActor; scope: PlanScope; timeZone: string; defaultTime: string | null }> {
  if (!isUuid(workspaceId)) throw workspaceNotFound()
  const { organizationId } = actor
  const organization = opts.write
    ? await assertActiveOrganization(tx, organizationId)
    : await tx.organizations.findById(organizationId)
  if (!organization || !isModuleEnabled(organization.settings, 'plan')) throw workspaceNotFound()
  const current = await currentActor(tx, actor)
  const workspace = await tx.workspaces.findVisibleById(current, workspaceId)
  const scope = { organizationId, workspaceId }
  if (!workspace || !can(current, 'plan.view', scope)) throw workspaceNotFound()
  if (!can(current, opts.need, scope))
    throw new DomainError('FORBIDDEN', FORBIDDEN[opts.need] ?? 'Non puoi farlo in questo cliente')
  if (opts.write) {
    const locked = await tx.workspaces.findForShare(organizationId, workspaceId)
    if (!locked || locked.archivedAt !== null)
      throw new DomainError('CONFLICT', 'Il cliente è archiviato: il suo piano non si modifica')
  }
  return {
    current,
    scope,
    timeZone: storedTimeZone(organization.settings),
    defaultTime: workspace.defaultPostTime,
  }
}

/** A route that names only the content: its client, then the same as `openPlan`. */
async function openItem(
  tx: Tx,
  actor: OrgActor,
  itemId: string,
  opts: Parameters<typeof openPlan>[3],
) {
  const located = isUuid(itemId) ? await tx.plan.locate(actor.organizationId, itemId) : null
  if (!located) throw planItemNotFound()
  try {
    return await openPlan(tx, actor, located.workspaceId, opts)
  } catch (error) {
    // a content of a client the person does not see is not found, as the client
    if (error instanceof DomainError && error.code === 'NOT_FOUND') throw planItemNotFound()
    throw error
  }
}

/** The post facts of each content's post, read with `getStatuses` of `posts`. */
async function postFacts(tx: Tx, organizationId: string, items: readonly PlanItemRecord[]) {
  const statuses = await getStatuses(
    tx,
    organizationId,
    items.flatMap((i) => (i.postId ? [i.postId] : [])),
  )
  return (item: PlanItemRecord): PlanPostFacts | null => {
    const status = item.postId ? statuses.get(item.postId) : undefined
    return status === undefined ? null : { status, scheduledAt: null }
  }
}

function toDto(
  item: PlanItemRecord,
  post: PlanPostFacts | null,
  now: Date,
  timeZone: string,
): PlanItemDto {
  return {
    id: item.id,
    workspaceId: item.workspaceId,
    localDate: item.localDate,
    localTime: item.localTime,
    type: item.type,
    title: item.title,
    note: item.note,
    postId: item.postId,
    state: planItemState(item, post, now, timeZone),
    dueAt: referenceInstant(item.localDate, item.localTime, timeZone).toISOString(),
    dueSoonAt: dueNotificationAt(item, timeZone).toISOString(),
    version: item.version,
  }
}

interface FieldsInput {
  localDate?: string
  localTime?: string | null
  type?: string
  title?: string
  note?: string
}

/** The fields given, checked and as stored; the others stay out. */
function checked(input: FieldsInput) {
  const out: {
    localDate?: string
    localTime?: string | null
    type?: PlanItemType
    title?: string
    note?: string
  } = {}
  if (input.localDate !== undefined) {
    if (!isLocalDate(input.localDate))
      throw new DomainError('VALIDATION', 'Scegli un giorno', { field: 'localDate' })
    out.localDate = input.localDate
  }
  if (input.localTime !== undefined) {
    if (input.localTime !== null && !TIME.test(input.localTime))
      throw new DomainError('VALIDATION', 'Scrivi l’ora così: 18:30', { field: 'localTime' })
    out.localTime = input.localTime
  }
  if (input.type !== undefined) {
    if (!(PLAN_ITEM_TYPES as readonly string[]).includes(input.type))
      throw new DomainError('VALIDATION', 'Scegli reel, carosello, foto o storia', {
        field: 'type',
      })
    out.type = input.type as PlanItemType
  }
  if (input.title !== undefined) {
    const title = planTitle(input.title)
    if (title === null)
      throw new DomainError('VALIDATION', 'Il titolo va da 1 a 80 caratteri, senza link', {
        field: 'title',
      })
    out.title = title
  }
  if (input.note !== undefined) {
    // a tab pasted from a document is a space, not a refusal
    const note = planNote(input.note.replace(/\t/g, ' '))
    if (note === null)
      throw new DomainError('VALIDATION', 'La nota arriva fino a 2.000 caratteri', {
        field: 'note',
      })
    out.note = note
  }
  return out
}

/** The plan of a client in the days `[from, to]` (at most 42), note included. */
export async function listPlan(
  deps: PlanDeps,
  actor: OrgActor,
  input: { workspaceId: string; from: string; to: string },
): Promise<{ timeZone: string; items: PlanItemDto[] }> {
  if (!isLocalDate(input.from) || !isLocalDate(input.to) || input.from > input.to)
    throw new DomainError('VALIDATION', 'Il periodo va dal primo all’ultimo giorno', {
      field: 'from',
    })
  if (daysBetween(input.from, input.to) > PLAN_RANGE_MAX_DAYS)
    throw new DomainError(
      'VALIDATION',
      `Il piano si legge al massimo ${String(PLAN_RANGE_MAX_DAYS)} giorni per volta`,
      { field: 'to' },
    )
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { scope, timeZone } = await openPlan(tx, actor, input.workspaceId, {
        need: 'plan.view',
        write: false,
      })
      const items = await tx.plan.listInRange(scope.organizationId, [scope.workspaceId], input)
      const factsOf = await postFacts(tx, scope.organizationId, items)
      const now = deps.clock.now()
      return { timeZone, items: items.map((i) => toDto(i, factsOf(i), now, timeZone)) }
    },
  )
}

/**
 * The content of the plan a post of the client was prepared from (§11.12, Task 7): the editor
 * shows its note, its type and its day. Whoever sees the client's plan reads it; a post that
 * does not come from the plan has none, and a post that is not the client's is not found.
 */
export async function planItemOfPost(
  deps: PlanDeps,
  actor: OrgActor,
  input: { workspaceId: string; postId: string },
): Promise<{ item: PlanItemDto | null }> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { scope, timeZone } = await openPlan(tx, actor, input.workspaceId, {
        need: 'plan.view',
        write: false,
      })
      if (!(await isPostOf(tx, scope, input.postId)))
        throw new DomainError('NOT_FOUND', 'Post non trovato')
      const [item] = (await tx.plan.findByPostIds(scope.organizationId, [input.postId])).filter(
        (i) => i.workspaceId === scope.workspaceId,
      )
      if (!item) return { item: null }
      const factsOf = await postFacts(tx, scope.organizationId, [item])
      return { item: toDto(item, factsOf(item), deps.clock.now(), timeZone) }
    },
  )
}

/** A new content: day, type and title; the time and the note when given. */
export async function createPlanItem(
  deps: PlanDeps & { ids: IdGenerator },
  actor: OrgActor,
  input: {
    workspaceId: string
    localDate: string
    localTime?: string | null
    type: string
    title: string
    note?: string
  },
): Promise<PlanItemDto> {
  const fields = checked({ localTime: null, note: '', ...input })
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope, timeZone } = await openPlan(tx, actor, input.workspaceId, {
        need: 'plan.edit',
        write: true,
      })
      const item = await tx.plan.create({
        id: deps.ids.newId(),
        ...scope,
        localDate: fields.localDate ?? input.localDate,
        localTime: fields.localTime ?? null,
        type: fields.type ?? 'photo',
        title: fields.title ?? '',
        note: fields.note ?? '',
        createdBy: current.userId,
      })
      return toDto(item, null, deps.clock.now(), timeZone)
    },
  )
}

/** Changes the fields given, if nobody changed the content since `version` (409 otherwise). */
export async function updatePlanItem(
  deps: PlanDeps,
  actor: OrgActor,
  input: { itemId: string; version: number } & FieldsInput,
): Promise<PlanItemDto> {
  const fields = checked(input)
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope, timeZone } = await openItem(tx, actor, input.itemId, {
        need: 'plan.edit',
        write: true,
      })
      const item = await tx.plan.findForUpdate(scope, input.itemId)
      if (!item) throw planItemNotFound()
      if (item.version !== input.version) throw versionConflict()
      const next = { ...item, ...fields, updatedBy: current.userId }
      const version = await tx.plan.update(scope, item.id, next, input.version)
      if (version === null) throw versionConflict()
      const factsOf = await postFacts(tx, scope.organizationId, [next])
      return toDto({ ...next, version }, factsOf(next), deps.clock.now(), timeZone)
    },
  )
}

/** Another day (and time) for the content: what dragging it does. */
export const movePlanItem = (
  deps: PlanDeps,
  actor: OrgActor,
  input: { itemId: string; version: number; localDate: string; localTime?: string | null },
) => updatePlanItem(deps, actor, input)

/** Takes the content off the plan; the post it became stays as it is (rule 4). */
export async function removePlanItem(
  deps: PlanDeps,
  actor: OrgActor,
  input: { itemId: string },
): Promise<void> {
  await deps.uow.run({ organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const { scope } = await openItem(tx, actor, input.itemId, { need: 'plan.edit', write: true })
    if (!(await tx.plan.remove(scope, input.itemId))) throw planItemNotFound()
  })
}

/** The time a prepared post starts at when nothing else gives one, as the editor (Matteo, 25/11). */
const FALLBACK_TIME = '14:00'

/**
 * «Prepara questo contenuto» (§11.12): a draft of the client with the content's type, day and
 * time, linked to the content in the same transaction. The time is the content's; without one
 * the client's first free slot of that day, then its usual time, then 14:00 as the editor: the
 * slots come first because every client has a usual time (Matteo, 25/11). A
 * content already prepared answers with its post (`created: false`); one whose post was
 * cancelled is prepared again and the link replaced (rule 5).
 */
export async function preparePlanItem(
  deps: PlanDeps,
  actor: OrgActor,
  input: { itemId: string; ip?: string | null },
): Promise<{ postId: string; created: boolean }> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope, timeZone, defaultTime } = await openItem(tx, actor, input.itemId, {
        need: 'plan.prepare',
        write: true,
      })
      // a second «Prepara» waits here and finds the first one's post
      const item = await tx.plan.findForUpdate(scope, input.itemId)
      if (!item) throw planItemNotFound()
      const factsOf = await postFacts(tx, scope.organizationId, [item])
      const post = factsOf(item)
      if (item.postId && post && post.status !== 'cancelled')
        return { postId: item.postId, created: false }
      const localTime =
        item.localTime ??
        (await freeSlotOn(tx, scope, item.localDate, timeZone, deps.clock.now())) ??
        defaultTime ??
        FALLBACK_TIME
      const { postId } = await createDraft(tx, current, {
        workspaceId: scope.workspaceId,
        type: item.type,
        when: { localDate: item.localDate, localTime },
        ip: input.ip ?? null,
      })
      if (!(await tx.plan.linkPost(scope, item.id, postId, current.userId)))
        throw planItemNotFound()
      return { postId, created: true }
    },
  )
}

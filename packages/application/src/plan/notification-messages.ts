import {
  addDays,
  can,
  groupListing,
  instantToZoned,
  isModuleEnabled,
  isPreparedBy,
  referenceInstant,
  storedTimeZone,
  type NotificationKindRule,
  type OrgActor,
  type PlanItem,
} from '@app/domain'
import { dayAndTime } from '../mail/index.js'
import type {
  DigestBlock,
  DigestContext,
  DigestSection,
  NotificationKind,
} from '../module-definition.js'
import {
  asString,
  contextLine,
  groupedMessage,
  kindKey,
  placeOf,
  type MessageContext,
  type NotifiedEvent,
} from '../notifications/index.js'
import type { Translate } from '../ports/translator.js'
import type { Tx } from '../ports/tx.js'
import { getStatuses } from '../posts/index.js'
import { currentActor } from '../workspaces/index.js'

// The plan's words (spec §11.12, §12.2, §12.4; plan 09 Task 8), read now in the recipient's
// scope: type, title, day and time, never the note (Scelta 11). A content prepared, removed or
// moved since its event is not sent: a moved one has an event of its own, with its new day. The
// centre, which reads a notice again later, keeps it as long as the content exists.

/** «giovedì 3 dicembre alle 10:00», or the day alone: the agency's day, as the plan writes it. */
function whenOf(t: Translate, item: Pick<PlanItem, 'localDate' | 'localTime'>): string {
  const { day } = dayAndTime(new Date(`${item.localDate}T12:00:00Z`), 'UTC')
  return item.localTime === null ? day : t('notify.plan.at', { day, time: item.localTime })
}

const typeOf = (t: Translate, item: Pick<PlanItem, 'type'>) => t(`posts.type.${item.type}`)

/** Whether the post still stands for each content: a cancelled or deleted one does not. */
async function preparedOf(tx: Tx, organizationId: string, items: readonly PlanItem[]) {
  const statuses = await getStatuses(
    tx,
    organizationId,
    items.flatMap((i) => (i.postId ? [i.postId] : [])),
  )
  return (item: PlanItem) => {
    const status = item.postId ? statuses.get(item.postId) : undefined
    return isPreparedBy(status === undefined ? null : { status, scheduledAt: null })
  }
}

/**
 * The contents the events are about. To send: only those still to prepare, on the day of their
 * event, of a client not archived since. In the centre, read later: every content still there,
 * so a notice already acted on keeps its words and its link.
 */
async function contentsOf(ctx: MessageContext, events: readonly NotifiedEvent[], timeZone: string) {
  const organizationId = ctx.organizationId
  if (organizationId === null) return []
  const found: PlanItem[] = []
  const archived = new Map<string, boolean>()
  for (const event of events) {
    const workspaceId = asString(event.payload.workspaceId)
    const id = asString(event.payload.planItemId)
    if (workspaceId === null || id === null) continue
    const item = await ctx.tx.plan.find({ organizationId, workspaceId }, id)
    if (!item) continue
    if (ctx.forCentre) {
      found.push(item)
      continue
    }
    const reference = referenceInstant(item.localDate, item.localTime, timeZone).toISOString()
    if (reference !== asString(event.payload.dueAt)) continue
    if (!archived.has(workspaceId)) {
      const workspace = await ctx.tx.workspaces.findById(organizationId, workspaceId)
      archived.set(workspaceId, !workspace || workspace.archivedAt !== null)
    }
    if (archived.get(workspaceId) !== true) found.push(item)
  }
  if (ctx.forCentre) return found
  const prepared = await preparedOf(ctx.tx, organizationId, found)
  return found.filter((i) => !prepared(i))
}

async function planMessage(
  rule: NotificationKindRule,
  ctx: MessageContext,
  events: readonly NotifiedEvent[],
) {
  if (ctx.organizationId === null) return null
  const organization = await ctx.tx.organizations.findById(ctx.organizationId)
  // the module turned off since: nothing more is said of the plan (P2)
  if (!organization || !isModuleEnabled(organization.settings, 'plan')) return null
  const place = await placeOf(ctx, events)
  if (!place) return null
  const items = await contentsOf(ctx, events, storedTimeZone(organization.settings))
  if (items.length === 0) return null
  const [first] = items
  const lines = items.map((i) =>
    ctx.t(kindKey(rule.type, 'line'), {
      type: typeOf(ctx.t, i),
      title: i.title,
      when: whenOf(ctx.t, i),
    }),
  )
  const url = new URL(`${encodeURIComponent(place.slug)}/piano`, ctx.panelUrl)
  if (place.workspace) url.searchParams.set('cliente', place.workspace.slug)
  if (items.length === 1 && first) url.searchParams.set('da', first.localDate)
  return groupedMessage({
    t: ctx.t,
    type: rule.type,
    level: rule.level,
    one: { title: first?.title ?? '' },
    lines,
    context: contextLine(ctx.t, place),
    link: { label: ctx.t('notify.open.plan'), url: url.toString() },
  })
}

/** A kind of the plan, with its words. */
export const planKind = (rule: NotificationKindRule): NotificationKind => ({
  ...rule,
  message: (ctx, events) => planMessage(rule, ctx, events),
})

/** The person as an actor of the agency: `currentActor` reads the role and the clients again. */
const actorOf = (ctx: DigestContext): OrgActor => ({
  userId: ctx.userId,
  platformRole: null,
  organizationId: ctx.organizationId,
  orgRole: 'member',
  memberships: new Map(),
})

/**
 * «Da preparare» (§12.4, Scelta 11): the contents of today and tomorrow not prepared yet, of the
 * clients where the person prepares the plan; the late ones of today too. Never the note.
 */
async function toPrepare(tx: Tx, ctx: DigestContext): Promise<DigestBlock | null> {
  const { organizationId } = ctx
  const organization = await tx.organizations.findById(organizationId)
  if (!organization || !isModuleEnabled(organization.settings, 'plan')) return null
  const current = await currentActor(tx, actorOf(ctx))
  const clients = (await tx.workspaces.listVisible(current)).filter(
    (w) =>
      w.archivedAt === null && can(current, 'plan.prepare', { organizationId, workspaceId: w.id }),
  )
  if (clients.length === 0) return null
  const names = new Map(clients.map((w) => [w.id, w.name] as const))
  const today = instantToZoned(ctx.now, ctx.timeZone).localDate
  const tomorrow = addDays(today, 1)
  const items = await tx.plan.listInRange(organizationId, [...names.keys()], {
    from: today,
    to: tomorrow,
  })
  const prepared = await preparedOf(tx, organizationId, items)
  const lines = items
    .filter((i) => !prepared(i))
    .map((i) => {
      const day = ctx.t(i.localDate === today ? 'digest.plan.today' : 'digest.plan.tomorrow')
      return ctx.t('digest.plan.line', {
        when: i.localTime === null ? day : ctx.t('notify.plan.at', { day, time: i.localTime }),
        client: names.get(i.workspaceId) ?? '',
        type: typeOf(ctx.t, i),
        title: i.title,
      })
    })
  if (lines.length === 0) return null
  const { shown, more } = groupListing(lines)
  return {
    title:
      lines.length === 1
        ? ctx.t('digest.plan.one')
        : ctx.t('digest.plan.many', { n: String(lines.length) }),
    lines: shown,
    more,
  }
}

/** After the posts of today and the open problems, before the accounts (§12.4). */
export const planDigestSections: readonly DigestSection[] = [
  { id: 'plan.to_prepare', order: 40, build: toPrepare },
]

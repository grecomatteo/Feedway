import {
  groupListing,
  type Level,
  type OutboxEventType,
  type OutboxPayload,
  type Platform,
} from '@app/domain'
import type { RenderedMessage } from '../ports/notification-channel.js'
import type { Translate } from '../ports/translator.js'
import type { Tx } from '../ports/tx.js'

// What a kind's `message` works with (plan 08, P3): the events of one group, and a transaction
// in the recipient's scope, so the words say only what the person may see now.

/** One notification of the group: its event's ids and codes, never a text. */
export interface NotifiedEvent {
  eventId: string
  type: OutboxEventType
  payload: OutboxPayload
  workspaceId: string | null
  createdAt: Date
}

export interface MessageContext {
  /** `uow.run({ organizationId, userId })` of the recipient; the system's for the platform */
  tx: Tx
  /** null: an event of the platform */
  organizationId: string | null
  userId: string
  t: Translate
  panelUrl: URL
  /** The person's zone, for the dates */
  timeZone: string
  /**
   * The centre reads a notification again later: a kind that leaves out what no longer needs
   * telling (the plan's prepared contents) keeps it there, and says null only when it is gone.
   */
  forCentre?: boolean
}

export const asString = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

/** The kind's key in it.json: `post.target_failed` → `notify.kinds.post_target_failed`. */
export const kindKey = (type: OutboxEventType, part: string) =>
  `notify.kinds.${type.replace('.', '_')}.${part}`

export const platformName = (t: Translate, platform: Platform) => t(`notify.platform.${platform}`)

/** An absolute address of the panel; the path's parts are encoded. */
export function panelLink(ctx: Pick<MessageContext, 'panelUrl'>, ...parts: string[]): string {
  return new URL(parts.map(encodeURIComponent).join('/'), ctx.panelUrl).toString()
}

export interface AgencyPlace {
  name: string
  slug: string
  /** The client, when every event of the group is about the same one */
  workspace: { id: string; name: string; slug: string } | null
}

/** The agency and, when the group is about one client, the client. null: the agency is gone. */
export async function placeOf(
  ctx: MessageContext,
  events: readonly NotifiedEvent[],
): Promise<AgencyPlace | null> {
  if (ctx.organizationId === null) return null
  const organization = await ctx.tx.organizations.findById(ctx.organizationId)
  if (!organization) return null
  const ids = new Set(events.map((e) => e.workspaceId))
  const [only] = ids
  const workspace =
    ids.size === 1 && typeof only === 'string'
      ? await ctx.tx.workspaces.findById(ctx.organizationId, only)
      : null
  return {
    name: organization.name,
    slug: organization.slug,
    workspace: workspace && { id: workspace.id, name: workspace.name, slug: workspace.slug },
  }
}

/** «Agenzia · Cliente», or the agency alone. */
export function contextLine(t: Translate, place: AgencyPlace | null): string | null {
  if (!place) return null
  return place.workspace
    ? t('notify.contextOf', { agency: place.name, client: place.workspace.name })
    : place.name
}

/** One message: the title for one or for many, the lines up to ten and «e altre N». */
export function groupedMessage(input: {
  t: Translate
  type: OutboxEventType
  level: Level
  /** the values of the title for one event («{account}») */
  one: Readonly<Record<string, string>>
  lines: readonly string[]
  /** a sentence after the lines, for one event only («Il post è programmato…») */
  note?: string | null
  context: string | null
  link: RenderedMessage['link']
}): RenderedMessage {
  const { shown, more } = groupListing(input.lines)
  const title =
    input.lines.length === 1
      ? input.t(kindKey(input.type, 'one'), input.one)
      : input.t(kindKey(input.type, 'many'), { n: String(input.lines.length) })
  return {
    level: input.level,
    title,
    context: input.context,
    lines: input.note ? [...shown, input.note] : shown,
    more,
    link: input.link,
  }
}

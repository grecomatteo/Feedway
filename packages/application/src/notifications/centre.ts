import { DomainError, type Channel, type Level, type OutboxEventType } from '@app/domain'
import { isUuid } from '../identity/index.js'
import { usableTimeZone } from '../mail/index.js'
import type { NotificationKind } from '../module-definition.js'
import type { Clock } from '../ports/clock.js'
import type {
  CentreCursor,
  CentreNotification,
  DeliveryRef,
  NotificationFilter,
} from '../ports/notifications.js'
import type { UserRecord } from '../ports/repositories.js'
import type { Translate } from '../ports/translator.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { eligibleUser, placeOf } from './recipients.js'

// The notification centre and the bell (plan 08 Task 6, §12.3, P6): the person reads their own
// rows of every agency where they are an active member, in their own scope. The words are built
// when the row is read (P3), in the agency's scope with the person as the actor: someone who no
// longer sees the client reads that they no longer see it, not what happened.

export interface CentreDeps {
  uow: UnitOfWork
  clock: Clock
  t: Translate
  panelUrl: URL
  defaultTimezone: string
  kinds: ReadonlyMap<OutboxEventType, NotificationKind>
}

export interface CentreQuery {
  organizationId?: string | null
  workspaceId?: string | null
  level?: Level | null
  kind?: OutboxEventType | null
  unreadOnly?: boolean
  /** From the previous page: `nextCursor` */
  cursor?: string | null
  limit?: number
}

export interface CentreItem {
  id: string
  kind: OutboxEventType
  level: Level
  createdAt: Date
  readAt: Date | null
  /** null: a notification of the platform */
  organization: { id: string; slug: string; name: string } | null
  workspaceId: string | null
  title: string
  /** The first line of the message: the account and the post, the reason */
  detail: string | null
  /** «Agenzia · Cliente» */
  context: string | null
  /** A path of the panel, never another site */
  link: { label: string; path: string } | null
  deliveries: readonly {
    channel: Channel
    status: DeliveryRef['status']
    error: string | null
    sentAt: Date | null
  }[]
}

export interface CentrePage {
  items: CentreItem[]
  nextCursor: string | null
  unread: number
}

export const CENTRE_PAGE_DEFAULT = 20
export const CENTRE_PAGE_MAX = 50

const notFound = () => new DomainError('NOT_FOUND', 'Notifica non trovata')

export function encodeCursor(c: CentreCursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`).toString('base64url')
}

export function decodeCursor(value: string): CentreCursor {
  const [at, id] = Buffer.from(value, 'base64url').toString('utf8').split('|')
  const createdAt = new Date(at ?? '')
  if (!id || !isUuid(id) || Number.isNaN(createdAt.getTime()))
    throw new DomainError('VALIDATION', 'Pagina delle notifiche non valida', { field: 'cursor' })
  return { createdAt, id }
}

interface Viewer {
  user: UserRecord
  /** The agencies the person works in now: active member of an active agency */
  organizations: Map<string, { id: string; slug: string; name: string }>
  filter: NotificationFilter
}

/** Who reads and which rows they may see now (P6; a suspended agency waits, D-112 punto 6). */
async function viewerOf(tx: Tx, userId: string, query: CentreQuery = {}): Promise<Viewer> {
  const user = await tx.users.findById(userId)
  if (user?.status !== 'active' || user.anonymizedAt !== null) throw notFound()
  const organizations = new Map(
    (await tx.orgMembers.listForUser(userId))
      .filter((m) => m.status === 'active' && m.organizationStatus === 'active')
      .map((m) => [m.organizationId, { id: m.organizationId, slug: m.slug, name: m.name }]),
  )
  return {
    user,
    organizations,
    filter: {
      organizationIds: [...organizations.keys()],
      platform: user.platformRole === 'admin',
      organizationId: query.organizationId ?? null,
      workspaceId: query.workspaceId ?? null,
      level: query.level ?? null,
      kind: query.kind ?? null,
      unreadOnly: query.unreadOnly ?? false,
    },
  }
}

/** The path of a panel's address; an address of another site gives none. */
export function panelPath(url: string, panelUrl: URL): string | null {
  let parsed: URL
  try {
    parsed = new URL(url, panelUrl)
  } catch {
    return null
  }
  if (parsed.origin !== panelUrl.origin) return null
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

type Words = Pick<CentreItem, 'title' | 'detail' | 'context' | 'link'>

async function wordsOf(
  deps: CentreDeps,
  tx: Tx,
  viewer: Viewer,
  row: CentreNotification,
): Promise<Words> {
  const { t } = deps
  const agency = row.organizationId ? viewer.organizations.get(row.organizationId) : undefined
  const fallback = (title: string): Words => ({
    title,
    detail: null,
    context: agency?.name ?? null,
    link: null,
  })
  const kind = deps.kinds.get(row.kind)
  if (!kind) return fallback(t('notify.centre.gone'))
  // who can no longer see what it is about reads only that (Review Focus 3, P3)
  const current = await eligibleUser(
    tx,
    viewer.user.id,
    { ...placeOf(row.organizationId, row.payload), workspaceId: row.workspaceId },
    kind.recipients,
  )
  if (!current) return fallback(t('notify.centre.noAccess'))
  const message = await kind.message(
    {
      tx,
      organizationId: row.organizationId,
      userId: viewer.user.id,
      t,
      panelUrl: deps.panelUrl,
      timeZone: usableTimeZone(viewer.user.timezone, deps.defaultTimezone),
    },
    [
      {
        eventId: row.eventId,
        type: row.kind,
        payload: row.payload,
        workspaceId: row.workspaceId,
        createdAt: row.createdAt,
      },
    ],
  )
  if (!message) return fallback(t('notify.centre.gone'))
  const path = message.link ? panelPath(message.link.url, deps.panelUrl) : null
  return {
    title: message.title,
    detail: message.lines[0] ?? null,
    context: message.context,
    link: message.link && path !== null ? { label: message.link.label, path } : null,
  }
}

function itemOf(viewer: Viewer, row: CentreNotification, words: Words): CentreItem {
  return {
    id: row.id,
    kind: row.kind,
    level: row.level,
    createdAt: row.createdAt,
    readAt: row.readAt,
    organization: row.organizationId
      ? (viewer.organizations.get(row.organizationId) ?? null)
      : null,
    workspaceId: row.workspaceId,
    ...words,
    deliveries: row.deliveries,
  }
}

/** A page of the centre, newest first, with the count of the unread ones for the bell. */
export async function listMyNotifications(
  deps: CentreDeps,
  userId: string,
  query: CentreQuery = {},
): Promise<CentrePage> {
  const limit = Math.min(Math.max(query.limit ?? CENTRE_PAGE_DEFAULT, 1), CENTRE_PAGE_MAX)
  const after = query.cursor ? decodeCursor(query.cursor) : null
  const read = await deps.uow.run({ userId }, async (tx) => {
    const viewer = await viewerOf(tx, userId, query)
    // asking for an agency the person is not in is an empty page, never someone else's rows
    const rows = await tx.notifications.listForUser(userId, viewer.filter, {
      after,
      limit: limit + 1,
    })
    const unread = await tx.notifications.countUnread(userId, {
      organizationIds: viewer.filter.organizationIds,
      platform: viewer.filter.platform,
    })
    const page = rows.slice(0, limit)
    // the platform's rows are worded in the person's own scope: they read no agency data
    const items = new Map<string, CentreItem>()
    for (const row of page.filter((r) => r.organizationId === null))
      items.set(row.id, itemOf(viewer, row, await wordsOf(deps, tx, viewer, row)))
    return { viewer, page, more: rows.length > limit, unread, items }
  })
  const { viewer, page, items } = read
  // each agency's rows are worded in its own scope, with the person as the actor (P3)
  const agencies = [...new Set(page.flatMap((r) => (r.organizationId ? [r.organizationId] : [])))]
  for (const organizationId of agencies) {
    const rows = page.filter((r) => r.organizationId === organizationId)
    await deps.uow.run({ organizationId, userId }, async (tx) => {
      for (const row of rows)
        items.set(row.id, itemOf(viewer, row, await wordsOf(deps, tx, viewer, row)))
    })
  }
  const last = page.at(-1)
  return {
    items: page.flatMap((r) => {
      const item = items.get(r.id)
      return item ? [item] : []
    }),
    nextCursor: read.more && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    unread: read.unread,
  }
}

/** The bell's number (Scelta 5): read every 30 seconds while the tab is visible. */
export async function countMyUnreadNotifications(
  deps: Pick<CentreDeps, 'uow'>,
  userId: string,
): Promise<number> {
  return deps.uow.run({ userId }, async (tx) => {
    const viewer = await viewerOf(tx, userId)
    return tx.notifications.countUnread(userId, viewer.filter)
  })
}

/** «Segna come letta»: also when the person opens it. Another's is not found. */
export async function markMyNotificationRead(
  deps: Pick<CentreDeps, 'uow' | 'clock'>,
  userId: string,
  id: string,
): Promise<void> {
  if (!isUuid(id)) throw notFound()
  await deps.uow.run({ userId }, async (tx) => {
    const viewer = await viewerOf(tx, userId)
    const found = await tx.notifications.findForUser(userId, id)
    const visible =
      found !== null &&
      (found.organizationId === null
        ? viewer.filter.platform
        : viewer.organizations.has(found.organizationId))
    if (!visible) throw notFound()
    await tx.notifications.markRead(userId, viewer.filter, [id], deps.clock.now())
  })
}

/** «Segna tutte come lette»: every one the person sees now. Returns how many changed. */
export async function markAllMyNotificationsRead(
  deps: Pick<CentreDeps, 'uow' | 'clock'>,
  userId: string,
): Promise<number> {
  return deps.uow.run({ userId }, async (tx) => {
    const viewer = await viewerOf(tx, userId)
    return tx.notifications.markRead(userId, viewer.filter, 'all', deps.clock.now())
  })
}

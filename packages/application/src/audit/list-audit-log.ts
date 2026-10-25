import { can, displayName, DomainError, type OrgActor } from '@app/domain'
import { assertOneOf, isUuid } from '../identity/index.js'
import {
  AUDIT_ACTIONS,
  AUDIT_SOURCES,
  type AuditAction,
  type AuditQuery,
  type AuditRecord,
  type AuditSource,
} from '../ports/audit-log.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { assertActiveOrganization, currentActor, workspaceNotFound } from '../workspaces/index.js'

export interface AuditLogFilter {
  workspaceId?: string
  actorId?: string
  action?: AuditAction
  source?: AuditSource
  /** Inclusive. */
  from?: Date
  /** Exclusive. */
  to?: Date
  cursor?: string
  /** 1 to 100; 50 when missing. */
  limit?: number
}

/** No IP: the panel's log shows who did what and when, not from where (data minimisation). */
export interface AuditItemDto {
  id: string
  organizationId: string
  /** null for the system, and for an author who is not a person of this agency. */
  actorId: string | null
  /** Nickname or name; "Utente rimosso" when anonymized; "Sistema" without an author. */
  authorName: string
  action: AuditAction
  entity: string | null
  entityId: string | null
  workspaceId: string | null
  source: AuditSource
  createdAt: string
  data: Record<string, unknown>
}

export const DEFAULT_AUDIT_PAGE = 50
export const MAX_AUDIT_PAGE = 100
const SYSTEM_AUTHOR = 'Sistema'
const REMOVED_AUTHOR = 'Utente rimosso'

const invalid = (field: string) => new DomainError('VALIDATION', 'Valore non valido', { field })
const forbidden = () =>
  new DomainError('FORBIDDEN', 'Non hai i permessi per consultare il registro attività')

// timestamptz accepts more than JavaScript dates, and less (no year 0): keep both sides happy
const EARLIEST = Date.UTC(1970, 0, 1)
const LATEST = Date.UTC(10000, 0, 1)
const POSITION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const BASE64URL = /^[A-Za-z0-9_-]{1,200}$/

function validDate(value: unknown, field: string): Date {
  if (!(value instanceof Date)) throw invalid(field)
  const time = value.getTime()
  if (Number.isNaN(time) || time < EARLIEST || time >= LATEST) throw invalid(field)
  return value
}

export function encodeAuditCursor(record: Pick<AuditRecord, 'position' | 'id'>): string {
  return Buffer.from(`${record.position}|${record.id}`).toString('base64url')
}

/**
 * The cursor only places the page: filters and the agency come from the request. Anything that
 * is not exactly what `encodeAuditCursor` writes is refused before it reaches SQL.
 */
export function decodeAuditCursor(cursor: unknown): { position: string; id: string } {
  if (typeof cursor !== 'string' || !BASE64URL.test(cursor)) throw invalid('cursor')
  const text = Buffer.from(cursor, 'base64url').toString('latin1')
  // one spelling per cursor: no padding, no trailing bits, no other characters
  if (Buffer.from(text, 'latin1').toString('base64url') !== cursor) throw invalid('cursor')
  const parts = text.split('|')
  if (parts.length !== 2) throw invalid('cursor')
  const [position = '', id = ''] = parts
  if (!POSITION.test(position) || !isUuid(id)) throw invalid('cursor')
  // the milliseconds must name a real instant (no 30 February, no hour 25)
  const millis = `${position.slice(0, 23)}Z`
  const date = new Date(millis)
  if (Number.isNaN(date.getTime()) || date.toISOString() !== millis) throw invalid('cursor')
  validDate(date, 'cursor')
  return { position, id }
}

function validFilter(filter: AuditLogFilter): Omit<AuditQuery, 'organizationId'> {
  const query: Omit<AuditQuery, 'organizationId'> = { limit: DEFAULT_AUDIT_PAGE }
  // a workspace id that is not a UUID is a workspace that does not exist
  if (filter.workspaceId !== undefined) {
    if (typeof filter.workspaceId !== 'string' || !isUuid(filter.workspaceId))
      throw workspaceNotFound()
    query.workspaceId = filter.workspaceId
  }
  if (filter.actorId !== undefined) {
    if (typeof filter.actorId !== 'string' || !isUuid(filter.actorId)) throw invalid('actorId')
    query.actorId = filter.actorId
  }
  if (filter.action !== undefined) {
    assertOneOf(filter.action, AUDIT_ACTIONS, 'action')
    query.action = filter.action
  }
  if (filter.source !== undefined) {
    assertOneOf(filter.source, AUDIT_SOURCES, 'source')
    query.source = filter.source
  }
  if (filter.from !== undefined) query.from = validDate(filter.from, 'from')
  if (filter.to !== undefined) query.to = validDate(filter.to, 'to')
  if (query.from && query.to && query.from.getTime() >= query.to.getTime()) throw invalid('to')
  if (filter.limit !== undefined) {
    const { limit } = filter
    if (
      typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_AUDIT_PAGE
    )
      throw invalid('limit')
    query.limit = limit
  }
  if (filter.cursor !== undefined) query.after = decodeAuditCursor(filter.cursor)
  return query
}

/**
 * Who may read which part of the log, decided on the actor as the database has them now:
 * `audit.view_all` (Owner, Admin) everything, with an optional workspace; `audit.view_workspace`
 * (Manager) one workspace at a time. A workspace the actor does not see is not found.
 */
async function assertMayRead(tx: Tx, actor: OrgActor, workspaceId: string | undefined) {
  const { organizationId } = actor
  if (workspaceId === undefined) {
    if (!can(actor, 'audit.view_all', { organizationId })) throw forbidden()
    return
  }
  const workspace = await tx.workspaces.findVisibleById(actor, workspaceId)
  if (!workspace) throw workspaceNotFound()
  if (
    !can(actor, 'audit.view_all', { organizationId }) &&
    !can(actor, 'audit.view_workspace', { organizationId, workspaceId })
  )
    throw forbidden()
}

/**
 * Names only for this agency's people: an author id that is not one of its members (read under
 * its row level security) is never looked up, so no name of another agency can surface here.
 */
async function authors(tx: Tx, organizationId: string, records: AuditRecord[]) {
  const wanted = new Set(records.flatMap((r) => (r.actorId === null ? [] : [r.actorId])))
  if (wanted.size === 0) return new Map<string, string>()
  const members = (await tx.orgMembers.listForOrganization(organizationId))
    .map((m) => m.userId)
    .filter((id) => wanted.has(id))
  const names = new Map<string, string>()
  for (const user of await tx.users.summaries(members))
    names.set(user.id, user.anonymizedAt === null ? displayName(user) : REMOVED_AUTHOR)
  return names
}

/**
 * The agency's activity log, newest first, a page at a time (spec §14.4, "Registro attività").
 * Entries without an agency (platform, personal) never appear.
 */
export async function listAuditLog(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  filter: AuditLogFilter,
): Promise<{ items: AuditItemDto[]; nextCursor: string | null }> {
  const query = validFilter(filter)
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const current = await currentActor(tx, actor)
    await assertActiveOrganization(tx, organizationId)
    await assertMayRead(tx, current, query.workspaceId)
    const records = await tx.audit.listForOrganization({
      ...query,
      organizationId,
      limit: query.limit + 1,
    })
    const page = records.slice(0, query.limit)
    const names = await authors(tx, organizationId, page)
    const last = page.at(-1)
    return {
      items: page.map((r) => {
        const name = r.actorId === null ? undefined : names.get(r.actorId)
        return {
          id: r.id,
          organizationId: r.organizationId,
          actorId: name === undefined ? null : r.actorId,
          authorName: r.actorId === null ? SYSTEM_AUTHOR : (name ?? REMOVED_AUTHOR),
          action: r.action,
          entity: r.entity,
          entityId: r.entityId,
          workspaceId: r.workspaceId,
          source: r.source,
          createdAt: r.createdAt.toISOString(),
          data: r.data,
        }
      }),
      nextCursor: records.length > query.limit && last ? encodeAuditCursor(last) : null,
    }
  })
}

import { and, count, eq, gt, isNull, sql, type SQL } from 'drizzle-orm'
import { DomainError } from '@app/domain'
import type {
  InviteRecord,
  InvitesRepository,
  OrganizationKeysRepository,
  OrganizationRecord,
  OrganizationsRepository,
  OrgMemberRecord,
  OrgMembersRepository,
} from '@app/application'
import type { DbExecutor } from '../client.js'
import type { TxContext } from '../tx-context.js'
import { invites, organizationKeys, organizationMembers, organizations } from './schema.js'

// Every query names the organization even though RLS already limits the rows: two barriers.
export function drizzleOrganizationKeys(db: DbExecutor): OrganizationKeysRepository {
  return {
    async list(organizationId) {
      return db
        .select({
          version: organizationKeys.version,
          keyEnc: organizationKeys.keyEnc,
          retiredAt: organizationKeys.retiredAt,
        })
        .from(organizationKeys)
        .where(eq(organizationKeys.organizationId, organizationId))
        .orderBy(organizationKeys.version)
    },
    async insert(organizationId, version, keyEnc) {
      await db.insert(organizationKeys).values({ organizationId, version, keyEnc })
    },
    async retire(organizationId, version, at) {
      await db
        .update(organizationKeys)
        .set({ retiredAt: at })
        .where(
          and(
            eq(organizationKeys.organizationId, organizationId),
            eq(organizationKeys.version, version),
            isNull(organizationKeys.retiredAt),
          ),
        )
    },
  }
}

// The check constraints keep the text columns inside the record unions.

const organizationColumns = {
  id: organizations.id,
  name: organizations.name,
  slug: organizations.slug,
  status: organizations.status,
  limits: organizations.limits,
  settings: organizations.settings,
  suspendedAt: organizations.suspendedAt,
  createdAt: organizations.createdAt,
}

type OrganizationRow = Omit<OrganizationRecord, 'status' | 'limits' | 'settings'> & {
  status: string
  limits: unknown
  settings: unknown
}

const toOrganization = (row: OrganizationRow): OrganizationRecord => ({
  ...row,
  status: row.status as OrganizationRecord['status'],
  // objects by default; the domain parses them (organizations/limits, settings)
  limits: row.limits as Record<string, unknown>,
  settings: row.settings as Record<string, unknown>,
})

export function drizzleOrganizations(db: DbExecutor, ctx: TxContext): OrganizationsRepository {
  const onlySystem = (what: string) => {
    if (ctx.kind !== 'system') throw new Error(`${what} only in the system scope`)
  }
  // RLS also lists every agency the user belongs to (switcher); inside an agency only that
  // agency is readable here.
  const outOfScope = (id: string) => ctx.kind === 'organization' && ctx.organizationId !== id
  return {
    async findById(id) {
      if (outOfScope(id)) return null
      const [row] = await db
        .select(organizationColumns)
        .from(organizations)
        .where(eq(organizations.id, id))
      return row ? toOrganization(row) : null
    },
    async findByIdForUpdate(id) {
      if (outOfScope(id)) return null
      const [row] = await db
        .select(organizationColumns)
        .from(organizations)
        .where(eq(organizations.id, id))
        .for('update')
      return row ? toOrganization(row) : null
    },
    async create(input) {
      await db.insert(organizations).values(input)
    },
    async slugExists(slug) {
      // only the system scope sees every agency: elsewhere a slug of another agency looks free
      onlySystem('slugs are checked')
      const [row] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1)
      return row !== undefined
    },
    async findBySlug(slug) {
      onlySystem('agencies are found by slug')
      const [row] = await db
        .select(organizationColumns)
        .from(organizations)
        .where(eq(organizations.slug, slug))
      return row ? toOrganization(row) : null
    },
    async listAll() {
      onlySystem('every agency is listed')
      const rows = await db
        .select(organizationColumns)
        .from(organizations)
        .orderBy(organizations.name, organizations.id)
      return rows.map(toOrganization)
    },
    async setStatus(id, status, at) {
      onlySystem('agencies are suspended')
      const changed = await db
        .update(organizations)
        .set({ status, suspendedAt: status === 'suspended' ? at : null })
        .where(and(eq(organizations.id, id), sql`${organizations.status} <> ${status}`))
        .returning({ id: organizations.id })
      return changed.length > 0
    },
    async setLimits(id, limits) {
      onlySystem('limits are set')
      await db.update(organizations).set({ limits }).where(eq(organizations.id, id))
    },
    async update(id, change) {
      if (ctx.kind !== 'organization' || ctx.organizationId !== id)
        throw new Error('an agency changes only its own settings, inside its own scope')
      const set: { name?: string; settings?: SQL } = {}
      if (change.name !== undefined) set.name = change.name
      // merged in SQL: keys other than the patch's stay as they are
      if (change.settings !== undefined)
        set.settings = sql`${organizations.settings} || ${JSON.stringify(change.settings)}::jsonb`
      if (Object.keys(set).length === 0) return
      await db.update(organizations).set(set).where(eq(organizations.id, id))
    },
  }
}

const memberColumns = {
  organizationId: organizationMembers.organizationId,
  userId: organizationMembers.userId,
  role: organizationMembers.role,
  status: organizationMembers.status,
}

const toMember = <R extends { role: string; status: string }>(row: R) => ({
  ...row,
  role: row.role as OrgMemberRecord['role'],
  status: row.status as OrgMemberRecord['status'],
})

export function drizzleOrgMembers(db: DbExecutor): OrgMembersRepository {
  return {
    async listForUser(userId) {
      const rows = await db
        .select({
          ...memberColumns,
          name: organizations.name,
          slug: organizations.slug,
          organizationStatus: organizations.status,
          require2fa: sql<string | null>`${organizations.settings}->>'require2fa'`,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(eq(organizationMembers.userId, userId))
        .orderBy(organizations.name, organizations.id)
      return rows.map((row) => ({
        ...toMember(row),
        organizationStatus: row.organizationStatus as 'active' | 'suspended',
        // an agency can only raise the bar: a value we do not know counts as the strictest
        require2fa: row.require2fa === null || row.require2fa === 'admins' ? row.require2fa : 'all',
      }))
    },
    async find(organizationId, userId) {
      const [row] = await db
        .select(memberColumns)
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, userId),
          ),
        )
      return row ? toMember(row) : null
    },
    async findForUpdate(organizationId, userId) {
      const [row] = await db
        .select(memberColumns)
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, userId),
          ),
        )
        .for('update')
      return row ? toMember(row) : null
    },
    async organizationCount(userId) {
      const { rows } = await db.execute<{ n: number }>(
        sql`select organization_count(${userId}) as n`,
      )
      return rows[0]?.n ?? 0
    },
    async addIfMissing(member) {
      // only the primary key: another conflict (a second owner) must fail, not vanish
      await db
        .insert(organizationMembers)
        .values(member)
        .onConflictDoNothing({
          target: [organizationMembers.organizationId, organizationMembers.userId],
        })
    },
    async listForOrganization(organizationId) {
      const rows = await db
        .select(memberColumns)
        .from(organizationMembers)
        .where(eq(organizationMembers.organizationId, organizationId))
        .orderBy(organizationMembers.createdAt, organizationMembers.userId)
      return rows.map(toMember)
    },
    async count(organizationId) {
      const [row] = await db
        .select({ n: count() })
        .from(organizationMembers)
        .where(eq(organizationMembers.organizationId, organizationId))
      return row?.n ?? 0
    },
    async lockSeats(organizationId) {
      await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`seats:${organizationId}`}))`)
    },
    async setStatus(organizationId, userId, status) {
      const changed = await db
        .update(organizationMembers)
        .set({ status })
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, userId),
            sql`${organizationMembers.status} <> ${status}`,
          ),
        )
        .returning({ userId: organizationMembers.userId })
      return changed.length > 0
    },
    async setRole(organizationId, userId, from, to) {
      const changed = await db
        .update(organizationMembers)
        .set({ role: to })
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, userId),
            eq(organizationMembers.role, from),
            eq(organizationMembers.status, 'active'),
          ),
        )
        .returning({ userId: organizationMembers.userId })
      return changed.length > 0
    },
  }
}

// No token hash: callers already hold the token.
const inviteColumns = {
  id: invites.id,
  organizationId: invites.organizationId,
  purpose: invites.purpose,
  email: invites.email,
  existingUserId: invites.existingUserId,
  reservedUserId: invites.reservedUserId,
  invitedBy: invites.invitedBy,
  orgRole: invites.orgRole,
  memberships: invites.memberships,
  expiresAt: invites.expiresAt,
  usedAt: invites.usedAt,
  createdAt: invites.createdAt,
}

type InviteRow = Omit<InviteRecord, 'purpose' | 'orgRole' | 'memberships'> & {
  purpose: string
  orgRole: string | null
  memberships: unknown
}

const toInvite = (row: InviteRow): InviteRecord => ({
  ...row,
  purpose: row.purpose as InviteRecord['purpose'],
  orgRole: row.orgRole as InviteRecord['orgRole'],
  // written only by our use cases (Tasks 12 and 15), which validate the shape
  memberships: row.memberships as InviteRecord['memberships'],
})

const LOCK_NOT_AVAILABLE = '55P03'

/** The Postgres error code, also when Drizzle wraps the driver error. */
function pgCode(error: unknown): string | undefined {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

export function drizzleInvites(db: DbExecutor): InvitesRepository {
  const valid = (tokenHash: Buffer, now: Date) =>
    and(eq(invites.tokenHash, tokenHash), isNull(invites.usedAt), gt(invites.expiresAt, now))
  return {
    async create(invite) {
      await db.insert(invites).values(invite)
    },
    async findValid(tokenHash, now) {
      const [row] = await db.select(inviteColumns).from(invites).where(valid(tokenHash, now))
      return row ? toInvite(row) : null
    },
    async lockForActivation(tokenHash, now) {
      try {
        // NOWAIT: a request waiting on the lock would hold a pooled connection while the holder
        // needs a second one for Better Auth; a burst on one link would starve the pool.
        const [row] = await db
          .select(inviteColumns)
          .from(invites)
          .where(valid(tokenHash, now))
          .for('update', { noWait: true })
        return row ? toInvite(row) : null
      } catch (error) {
        if (pgCode(error) === LOCK_NOT_AVAILABLE)
          throw new DomainError('CONFLICT', 'Attivazione già in corso: riprova tra poco')
        throw error
      }
    },
    async markUsed(id, at) {
      const result = await db
        .update(invites)
        .set({ usedAt: at })
        .where(and(eq(invites.id, id), isNull(invites.usedAt)))
      return (result.rowCount ?? 0) > 0
    },
    async reserveUserId(id, userId) {
      await db
        .update(invites)
        .set({ reservedUserId: userId })
        .where(and(eq(invites.id, id), isNull(invites.usedAt), isNull(invites.reservedUserId)))
    },
    async setOrganization(id, organizationId) {
      await db
        .update(invites)
        .set({ organizationId })
        .where(and(eq(invites.id, id), isNull(invites.organizationId)))
    },
    async expireOpen(purpose, at) {
      // two concurrent calls would each miss the other's new link: one at a time per purpose
      await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`invites:${purpose}`}))`)
      await db
        .update(invites)
        .set({ expiresAt: at })
        .where(and(eq(invites.purpose, purpose), isNull(invites.usedAt), gt(invites.expiresAt, at)))
    },
    async countOpen(organizationId, now) {
      const [row] = await db
        .select({ n: count() })
        .from(invites)
        .where(
          and(
            eq(invites.organizationId, organizationId),
            isNull(invites.usedAt),
            gt(invites.expiresAt, now),
          ),
        )
      return row?.n ?? 0
    },
  }
}

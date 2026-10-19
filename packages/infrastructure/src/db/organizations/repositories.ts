import { and, eq, gt, isNull, sql } from 'drizzle-orm'
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

export function drizzleOrganizations(db: DbExecutor, ctx: TxContext): OrganizationsRepository {
  return {
    async findById(id) {
      // RLS also lists every agency the user belongs to (switcher); inside an agency only that
      // agency is readable here.
      if (ctx.kind === 'organization' && ctx.organizationId !== id) return null
      const [row] = await db
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          status: organizations.status,
          limits: organizations.limits,
          settings: organizations.settings,
          suspendedAt: organizations.suspendedAt,
          createdAt: organizations.createdAt,
        })
        .from(organizations)
        .where(eq(organizations.id, id))
      if (!row) return null
      return {
        ...row,
        status: row.status as OrganizationRecord['status'],
        // objects by default; the domain parses them (organizations/limits, settings)
        limits: row.limits as Record<string, unknown>,
        settings: row.settings as Record<string, unknown>,
      }
    },
    async create(input) {
      await db.insert(organizations).values(input)
    },
    async slugExists(slug) {
      // only the system scope sees every agency: elsewhere a slug of another agency looks free
      if (ctx.kind !== 'system') throw new Error('slugs are checked only in the system scope')
      const [row] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1)
      return row !== undefined
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
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(eq(organizationMembers.userId, userId))
        .orderBy(organizations.name, organizations.id)
      return rows.map((row) => ({
        ...toMember(row),
        organizationStatus: row.organizationStatus as 'active' | 'suspended',
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
    async organizationCount(userId) {
      const { rows } = await db.execute<{ n: number }>(
        sql`select organization_count(${userId}) as n`,
      )
      return rows[0]?.n ?? 0
    },
    async addIfMissing(member) {
      await db.insert(organizationMembers).values(member).onConflictDoNothing()
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
      const [row] = await db
        .select(inviteColumns)
        .from(invites)
        .where(valid(tokenHash, now))
        .for('update')
      // A concurrent activation that committed first has set used_at: the lock waits for it and
      // Postgres re-checks the row, so the loser gets nothing here.
      return row ? toInvite(row) : null
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
      await db
        .update(invites)
        .set({ expiresAt: at })
        .where(and(eq(invites.purpose, purpose), isNull(invites.usedAt), gt(invites.expiresAt, at)))
    },
  }
}

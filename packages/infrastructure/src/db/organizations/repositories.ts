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

export function drizzleOrganizations(db: DbExecutor): OrganizationsRepository {
  return {
    async findById(id) {
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
        limits: row.limits as Record<string, unknown>,
        settings: row.settings as Record<string, unknown>,
      }
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

export function drizzleInvites(db: DbExecutor): InvitesRepository {
  return {
    async lockForActivation(tokenHash, now) {
      const [row] = await db
        .select(inviteColumns)
        .from(invites)
        .where(
          and(eq(invites.tokenHash, tokenHash), isNull(invites.usedAt), gt(invites.expiresAt, now)),
        )
        .for('update')
      if (!row) return null
      // A concurrent activation that committed first has set used_at: the lock waits for it and
      // Postgres re-checks the row, so the loser gets nothing here.
      return {
        ...row,
        purpose: row.purpose as InviteRecord['purpose'],
        orgRole: row.orgRole as InviteRecord['orgRole'],
        memberships: row.memberships as InviteRecord['memberships'],
      }
    },
    async markUsed(id, at) {
      await db
        .update(invites)
        .set({ usedAt: at })
        .where(and(eq(invites.id, id), isNull(invites.usedAt)))
    },
    async reserveUserId(id, userId) {
      await db
        .update(invites)
        .set({ reservedUserId: userId })
        .where(and(eq(invites.id, id), isNull(invites.usedAt)))
    },
  }
}

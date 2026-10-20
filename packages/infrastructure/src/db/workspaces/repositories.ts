import { and, count, eq, inArray, isNull } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { WorkspaceMembersRepository, WorkspacesRepository } from '@app/application'
import type { OrgActor, WorkspaceRole } from '@app/domain'
import { seesAllWorkspaces } from '@app/domain'
import type { DbExecutor } from '../client.js'
import { workspaceMembers, workspaces } from './schema.js'

const workspaceColumns = {
  id: workspaces.id,
  organizationId: workspaces.organizationId,
  name: workspaces.name,
  slug: workspaces.slug,
  logoKey: workspaces.logoKey,
  defaultPostTime: workspaces.defaultPostTime,
  archivedAt: workspaces.archivedAt,
  createdAt: workspaces.createdAt,
}

/**
 * Filter in SQL as well as through row level security, which only knows the agency: a Member
 * sees just the workspaces they belong to. null: the actor sees none.
 */
function visibleTo(actor: OrgActor): SQL | null {
  const inOrganization = eq(workspaces.organizationId, actor.organizationId)
  if (seesAllWorkspaces(actor)) return inOrganization
  const own = [...actor.memberships.keys()]
  if (own.length === 0) return null
  return and(inOrganization, inArray(workspaces.id, own)) ?? null
}

export function drizzleWorkspaces(db: DbExecutor): WorkspacesRepository {
  return {
    async listVisible(actor) {
      const where = visibleTo(actor)
      if (!where) return []
      return db
        .select(workspaceColumns)
        .from(workspaces)
        .where(where)
        .orderBy(workspaces.name, workspaces.id)
    },
    async findVisibleById(actor, id) {
      const where = visibleTo(actor)
      if (!where) return null
      const [row] = await db
        .select(workspaceColumns)
        .from(workspaces)
        .where(and(where, eq(workspaces.id, id)))
      return row ?? null
    },
    async countActive(organizationId) {
      const [row] = await db
        .select({ n: count() })
        .from(workspaces)
        .where(and(eq(workspaces.organizationId, organizationId), isNull(workspaces.archivedAt)))
      return row?.n ?? 0
    },
  }
}

export function drizzleWorkspaceMembers(db: DbExecutor): WorkspaceMembersRepository {
  return {
    async listForOrganization(organizationId) {
      const rows = await db
        .select({
          userId: workspaceMembers.userId,
          workspaceId: workspaceMembers.workspaceId,
          workspaceName: workspaces.name,
          role: workspaceMembers.role,
        })
        .from(workspaceMembers)
        .innerJoin(
          workspaces,
          and(
            eq(workspaces.organizationId, workspaceMembers.organizationId),
            eq(workspaces.id, workspaceMembers.workspaceId),
          ),
        )
        .where(eq(workspaceMembers.organizationId, organizationId))
        .orderBy(workspaces.name, workspaces.id)
      return rows.map((r) => ({ ...r, role: r.role as WorkspaceRole }))
    },
    async rolesOf(organizationId, userId) {
      const rows = await db
        .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.organizationId, organizationId),
            eq(workspaceMembers.userId, userId),
          ),
        )
      // the check constraint keeps role inside WORKSPACE_ROLES
      return new Map(rows.map((r) => [r.workspaceId, r.role as WorkspaceRole]))
    },
    async addIfMissing(member) {
      await db
        .insert(workspaceMembers)
        .values(member)
        .onConflictDoNothing({ target: [workspaceMembers.workspaceId, workspaceMembers.userId] })
    },
  }
}

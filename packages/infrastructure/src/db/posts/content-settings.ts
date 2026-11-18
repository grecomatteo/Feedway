import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { ContentSettingsRepository, PostScope } from '@app/application'
import type { CaptionTemplateKind, LabelColor } from '@app/domain'
import type { DbExecutor } from '../client.js'
import { accountGroups, captionTemplates, labels, postLabels } from './schema.js'

// Labels, caption templates and account groups of a workspace (spec §11.7, plan 06 Task 7).
// Every query filters by agency and workspace in SQL as well: row level security is the second
// barrier.

/** The unique index on the label's name said no. */
function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: unknown; cause?: { code?: unknown } }
  return e.code === '23505' || e.cause?.code === '23505'
}

const ofLabels = (scope: PostScope) =>
  and(eq(labels.organizationId, scope.organizationId), eq(labels.workspaceId, scope.workspaceId))
const ofTemplates = (scope: PostScope) =>
  and(
    eq(captionTemplates.organizationId, scope.organizationId),
    eq(captionTemplates.workspaceId, scope.workspaceId),
  )
const ofGroups = (scope: PostScope) =>
  and(
    eq(accountGroups.organizationId, scope.organizationId),
    eq(accountGroups.workspaceId, scope.workspaceId),
  )

export function drizzleContentSettings(db: DbExecutor): ContentSettingsRepository {
  return {
    async listLabels(scope) {
      const rows = await db
        .select({
          id: labels.id,
          name: labels.name,
          color: labels.color,
          createdAt: labels.createdAt,
          postCount: sql<number>`(select count(*)::int from ${postLabels} pl
            where pl.organization_id = ${labels.organizationId} and pl.label_id = ${labels.id})`,
        })
        .from(labels)
        .where(ofLabels(scope))
        .orderBy(asc(sql`lower(${labels.name})`), asc(labels.id))
      // the check constraint keeps the colour inside the list
      return rows.map((r) => ({ ...r, color: r.color as LabelColor }))
    },
    async existingLabels(scope, labelIds) {
      if (labelIds.length === 0) return new Set()
      const rows = await db
        .select({ id: labels.id })
        .from(labels)
        .where(and(ofLabels(scope), inArray(labels.id, [...labelIds])))
      return new Set(rows.map((r) => r.id))
    },
    async insertLabel(scope, label) {
      try {
        await db.transaction((sp) => sp.insert(labels).values({ ...scope, ...label }))
      } catch (error) {
        if (isUniqueViolation(error)) return 'taken'
        throw error
      }
      return 'created'
    },
    async updateLabel(scope, labelId, change) {
      try {
        const rows = await db.transaction((sp) =>
          sp
            .update(labels)
            .set({ ...change, updatedAt: new Date() })
            .where(and(ofLabels(scope), eq(labels.id, labelId)))
            .returning({ id: labels.id }),
        )
        return rows.length === 0 ? 'missing' : 'updated'
      } catch (error) {
        if (isUniqueViolation(error)) return 'taken'
        throw error
      }
    },
    async deleteLabel(scope, labelId) {
      // the posts lose it with the label (`post_labels_label_fk` cascades)
      const rows = await db
        .delete(labels)
        .where(and(ofLabels(scope), eq(labels.id, labelId)))
        .returning({ id: labels.id })
      return rows.length > 0
    },

    async listTemplates(scope) {
      const rows = await db
        .select({
          id: captionTemplates.id,
          kind: captionTemplates.kind,
          name: captionTemplates.name,
          body: captionTemplates.body,
          createdAt: captionTemplates.createdAt,
          updatedAt: captionTemplates.updatedAt,
        })
        .from(captionTemplates)
        .where(ofTemplates(scope))
        .orderBy(
          asc(captionTemplates.kind),
          asc(sql`lower(${captionTemplates.name})`),
          asc(captionTemplates.id),
        )
      return rows.map((r) => ({ ...r, kind: r.kind as CaptionTemplateKind }))
    },
    async countTemplates(scope) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(captionTemplates)
        .where(ofTemplates(scope))
      return row?.n ?? 0
    },
    async insertTemplate(scope, template) {
      await db.insert(captionTemplates).values({ ...scope, ...template })
    },
    async updateTemplate(scope, templateId, change) {
      const rows = await db
        .update(captionTemplates)
        .set({ ...change, updatedAt: new Date() })
        .where(and(ofTemplates(scope), eq(captionTemplates.id, templateId)))
        .returning({ id: captionTemplates.id })
      return rows.length > 0
    },
    async deleteTemplate(scope, templateId) {
      const rows = await db
        .delete(captionTemplates)
        .where(and(ofTemplates(scope), eq(captionTemplates.id, templateId)))
        .returning({ id: captionTemplates.id })
      return rows.length > 0
    },

    async listGroups(scope) {
      return db
        .select({
          id: accountGroups.id,
          name: accountGroups.name,
          accountIds: accountGroups.accountIds,
          createdAt: accountGroups.createdAt,
        })
        .from(accountGroups)
        .where(ofGroups(scope))
        .orderBy(asc(sql`lower(${accountGroups.name})`), asc(accountGroups.id))
    },
    async countGroups(scope) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(accountGroups)
        .where(ofGroups(scope))
      return row?.n ?? 0
    },
    async insertGroup(scope, group) {
      await db
        .insert(accountGroups)
        .values({ ...scope, ...group, accountIds: [...group.accountIds] })
    },
    async updateGroup(scope, groupId, change) {
      const rows = await db
        .update(accountGroups)
        .set({
          ...(change.name === undefined ? {} : { name: change.name }),
          ...(change.accountIds === undefined ? {} : { accountIds: [...change.accountIds] }),
          updatedAt: new Date(),
        })
        .where(and(ofGroups(scope), eq(accountGroups.id, groupId)))
        .returning({ id: accountGroups.id })
      return rows.length > 0
    },
    async deleteGroup(scope, groupId) {
      const rows = await db
        .delete(accountGroups)
        .where(and(ofGroups(scope), eq(accountGroups.id, groupId)))
        .returning({ id: accountGroups.id })
      return rows.length > 0
    },
  }
}

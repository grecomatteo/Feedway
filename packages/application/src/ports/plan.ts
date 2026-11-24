import type { PlanItem, PlanItemType } from '@app/domain'

// The contents of the editorial plan (spec §11.12, §13; plan 09 Task 5). Every method takes the
// agency and filters by it in SQL as well: row level security is the second barrier. The use
// cases (Task 6) check first that the actor sees the workspace.

export interface PlanScope {
  organizationId: string
  workspaceId: string
}

export type PlanItemRecord = PlanItem

/** What a new content stores; it starts at version 1 and without a post. */
export interface NewPlanItem {
  id: string
  organizationId: string
  workspaceId: string
  localDate: string
  localTime: string | null
  type: PlanItemType
  title: string
  note: string
  createdBy: string
}

/** The fields a change writes; the version goes up by one. */
export type PlanItemChange = Pick<
  PlanItem,
  'localDate' | 'localTime' | 'type' | 'title' | 'note' | 'updatedBy'
>

export interface PlanRepository {
  /** The contents of these workspaces in the days `[from, to]`, by day, time and id. */
  listInRange(
    organizationId: string,
    workspaceIds: readonly string[],
    range: { from: string; to: string },
  ): Promise<PlanItemRecord[]>
  /** The workspace of a content of the agency, for a route that names only the content. */
  locate(organizationId: string, id: string): Promise<{ workspaceId: string } | null>
  find(scope: PlanScope, id: string): Promise<PlanItemRecord | null>
  /** Same, and locks the content until the transaction ends. */
  findForUpdate(scope: PlanScope, id: string): Promise<PlanItemRecord | null>
  /** The contents that became one of these posts (the «dal piano» mark), whatever their day. */
  findByPostIds(organizationId: string, postIds: readonly string[]): Promise<PlanItemRecord[]>
  create(item: NewPlanItem): Promise<PlanItemRecord>
  /**
   * Writes the change if the content is still at `expectedVersion` and returns the new version;
   * null: someone changed it in between, or it is gone.
   */
  update(
    scope: PlanScope,
    id: string,
    change: PlanItemChange,
    expectedVersion: number,
  ): Promise<number | null>
  /** false: no such content. The post it became stays as it is (rule 4). */
  remove(scope: PlanScope, id: string): Promise<boolean>
  /**
   * The post the content became, or null; the version goes up. A post of another workspace, or
   * one already linked to another content, is refused by the database. False: no such content.
   */
  linkPost(scope: PlanScope, id: string, postId: string | null, updatedBy: string): Promise<boolean>
}

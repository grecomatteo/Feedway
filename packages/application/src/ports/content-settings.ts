import type { CaptionTemplateKind, LabelColor } from '@app/domain'
import type { PostScope } from './posts.js'

// The content settings of a workspace (spec §11.7, plan 06 Task 7): labels, caption templates
// and account groups. Every method takes the agency and the workspace and filters by them in
// SQL as well: row level security is the second barrier.

export interface LabelRecord {
  id: string
  name: string
  color: LabelColor
  /** the posts of the workspace that carry it */
  postCount: number
  createdAt: Date
}

export interface CaptionTemplateRecord {
  id: string
  kind: CaptionTemplateKind
  name: string
  body: string
  createdAt: Date
  updatedAt: Date
}

export interface AccountGroupRecord {
  id: string
  name: string
  /** as saved: an account taken off the workspace since stays here */
  accountIds: string[]
  createdAt: Date
}

export interface ContentSettingsRepository {
  /** By name, without case. */
  listLabels(scope: PostScope): Promise<LabelRecord[]>
  /** The ids given that are labels of the workspace. */
  existingLabels(scope: PostScope, labelIds: readonly string[]): Promise<Set<string>>
  /** 'taken': the workspace has a label with that name (case aside). */
  insertLabel(
    scope: PostScope,
    label: { id: string; name: string; color: LabelColor },
  ): Promise<'created' | 'taken'>
  updateLabel(
    scope: PostScope,
    labelId: string,
    change: { name?: string; color?: LabelColor },
  ): Promise<'updated' | 'taken' | 'missing'>
  /** Takes it off every post too. false: no such label. */
  deleteLabel(scope: PostScope, labelId: string): Promise<boolean>

  /** By kind, then by name. */
  listTemplates(scope: PostScope): Promise<CaptionTemplateRecord[]>
  countTemplates(scope: PostScope): Promise<number>
  insertTemplate(
    scope: PostScope,
    template: { id: string; kind: CaptionTemplateKind; name: string; body: string },
  ): Promise<void>
  updateTemplate(
    scope: PostScope,
    templateId: string,
    change: { kind?: CaptionTemplateKind; name?: string; body?: string },
  ): Promise<boolean>
  deleteTemplate(scope: PostScope, templateId: string): Promise<boolean>

  /** By name. */
  listGroups(scope: PostScope): Promise<AccountGroupRecord[]>
  countGroups(scope: PostScope): Promise<number>
  insertGroup(
    scope: PostScope,
    group: { id: string; name: string; accountIds: readonly string[] },
  ): Promise<void>
  updateGroup(
    scope: PostScope,
    groupId: string,
    change: { name?: string; accountIds?: readonly string[] },
  ): Promise<boolean>
  deleteGroup(scope: PostScope, groupId: string): Promise<boolean>
}

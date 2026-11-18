import {
  ACCOUNT_GROUP_MAX_ACCOUNTS,
  DomainError,
  validateGroupName,
  type OrgActor,
} from '@app/domain'
import { getAccountsForRules } from '../accounts/index.js'
import type { AccountGroupRecord } from '../ports/content-settings.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { PostScope } from '../ports/posts.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { CONTENT_SETTINGS_MAX, knownId, openContentSettings, tooMany } from './content-settings.js'

// The account groups of a workspace (spec §11.7, plan 06 Task 7): accounts saved together, to
// pick them with one tap in «Dove pubblicare». A group is saved with accounts of the workspace
// only; one taken off the workspace since stays in the group, the editor skips it and the
// client's page says so (`unavailableAccountIds`).

export interface AccountGroupDto {
  id: string
  name: string
  /** as saved, in order */
  accountIds: string[]
  /** the saved accounts that are no longer the workspace's */
  unavailableAccountIds: string[]
}

export const groupNotFound = () => new DomainError('NOT_FOUND', 'Gruppo non trovato')

function checkedName(raw: string): string {
  const name = validateGroupName(raw)
  if (name === null)
    throw new DomainError('VALIDATION', 'Il nome del gruppo va da 1 a 80 caratteri, senza link', {
      field: 'name',
    })
  return name
}

/** Accounts of the workspace, each once; an account of another workspace or agency is 404. */
async function checkedAccounts(tx: Tx, scope: PostScope, raw: readonly string[]) {
  const accountIds = [...new Set(raw)]
  if (accountIds.length === 0 || accountIds.length > ACCOUNT_GROUP_MAX_ACCOUNTS)
    throw new DomainError(
      'VALIDATION',
      `Un gruppo ha da 1 a ${String(ACCOUNT_GROUP_MAX_ACCOUNTS)} account`,
      { field: 'accountIds' },
    )
  const found = await getAccountsForRules(tx, scope, accountIds)
  if (accountIds.some((id) => !found.has(id)))
    throw new DomainError('NOT_FOUND', 'Account non trovato')
  return accountIds
}

/** The groups as the panel shows them, with what each one would skip today. */
async function toDtos(
  tx: Tx,
  scope: PostScope,
  groups: readonly AccountGroupRecord[],
): Promise<AccountGroupDto[]> {
  const inWorkspace = await getAccountsForRules(
    tx,
    scope,
    groups.flatMap((g) => g.accountIds),
  )
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    accountIds: g.accountIds,
    unavailableAccountIds: g.accountIds.filter((id) => !inWorkspace.has(id)),
  }))
}

export async function listAccountGroups(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string },
): Promise<{ items: AccountGroupDto[] }> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { scope } = await openContentSettings(tx, actor, input.workspaceId, { write: false })
      return { items: await toDtos(tx, scope, await tx.contentSettings.listGroups(scope)) }
    },
  )
}

async function readGroup(tx: Tx, scope: PostScope, groupId: string) {
  const group = (await tx.contentSettings.listGroups(scope)).find((g) => g.id === groupId)
  if (!group) throw groupNotFound()
  return group
}

export async function createAccountGroup(
  deps: { uow: UnitOfWork; ids: IdGenerator },
  actor: OrgActor,
  input: { workspaceId: string; name: string; accountIds: readonly string[] },
): Promise<AccountGroupDto> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { scope } = await openContentSettings(tx, actor, input.workspaceId, { write: true })
      const name = checkedName(input.name)
      if ((await tx.contentSettings.countGroups(scope)) >= CONTENT_SETTINGS_MAX)
        throw tooMany('gruppi')
      const accountIds = await checkedAccounts(tx, scope, input.accountIds)
      const id = deps.ids.newId()
      await tx.contentSettings.insertGroup(scope, { id, name, accountIds })
      const [dto] = await toDtos(tx, scope, [await readGroup(tx, scope, id)])
      if (!dto) throw groupNotFound()
      return dto
    },
  )
}

export async function updateAccountGroup(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; groupId: string; name?: string; accountIds?: readonly string[] },
): Promise<AccountGroupDto> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { scope } = await openContentSettings(tx, actor, input.workspaceId, { write: true })
      const name = input.name === undefined ? undefined : checkedName(input.name)
      const groupId = knownId(input.groupId, groupNotFound)
      await readGroup(tx, scope, groupId)
      const accountIds =
        input.accountIds === undefined
          ? undefined
          : await checkedAccounts(tx, scope, input.accountIds)
      const changed = await tx.contentSettings.updateGroup(scope, groupId, {
        ...(name === undefined ? {} : { name }),
        ...(accountIds === undefined ? {} : { accountIds }),
      })
      if (!changed) throw groupNotFound()
      const [dto] = await toDtos(tx, scope, [await readGroup(tx, scope, groupId)])
      if (!dto) throw groupNotFound()
      return dto
    },
  )
}

export async function deleteAccountGroup(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; groupId: string },
): Promise<void> {
  await deps.uow.run({ organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const { scope } = await openContentSettings(tx, actor, input.workspaceId, { write: true })
    const groupId = knownId(input.groupId, groupNotFound)
    if (!(await tx.contentSettings.deleteGroup(scope, groupId))) throw groupNotFound()
  })
}

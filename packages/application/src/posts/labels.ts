import { DomainError, validateLabel, type LabelColor, type OrgActor } from '@app/domain'
import type { IdGenerator } from '../ports/id-generator.js'
import type { LabelRecord } from '../ports/content-settings.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { CONTENT_SETTINGS_MAX, knownId, openContentSettings, tooMany } from './content-settings.js'

// The coloured labels of a workspace (spec §11.7, plan 06 Task 7). A post carries them with
// `labelIds`; deleting a label takes it off every post.

export interface LabelDto {
  id: string
  name: string
  color: LabelColor
  /** the posts of the client that carry it */
  postCount: number
}

const toDto = (l: LabelRecord): LabelDto => ({
  id: l.id,
  name: l.name,
  color: l.color,
  postCount: l.postCount,
})

export const labelNotFound = () => new DomainError('NOT_FOUND', 'Etichetta non trovata')

const nameTaken = () =>
  new DomainError('CONFLICT', 'Questo cliente ha già un’etichetta con questo nome', {
    field: 'name',
  })

function checked(raw: { name: string; color: string }) {
  const result = validateLabel(raw)
  if (!result.ok)
    throw new DomainError(
      'VALIDATION',
      result.field === 'name'
        ? 'Il nome dell’etichetta va da 1 a 40 caratteri, senza link'
        : 'Scegli uno dei colori proposti',
      { field: result.field },
    )
  return result.value
}

export async function listLabels(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string },
): Promise<{ items: LabelDto[] }> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { scope } = await openContentSettings(tx, actor, input.workspaceId, { write: false })
      return { items: (await tx.contentSettings.listLabels(scope)).map(toDto) }
    },
  )
}

export async function createLabel(
  deps: { uow: UnitOfWork; ids: IdGenerator },
  actor: OrgActor,
  input: { workspaceId: string; name: string; color: string },
): Promise<LabelDto> {
  const value = checked(input)
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { scope } = await openContentSettings(tx, actor, input.workspaceId, { write: true })
      const existing = await tx.contentSettings.listLabels(scope)
      if (existing.length >= CONTENT_SETTINGS_MAX) throw tooMany('etichette')
      const id = deps.ids.newId()
      if ((await tx.contentSettings.insertLabel(scope, { id, ...value })) === 'taken')
        throw nameTaken()
      return { id, ...value, postCount: 0 }
    },
  )
}

export async function updateLabel(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; labelId: string; name?: string; color?: string },
): Promise<LabelDto> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { scope } = await openContentSettings(tx, actor, input.workspaceId, { write: true })
      const labelId = knownId(input.labelId, labelNotFound)
      const current = (await tx.contentSettings.listLabels(scope)).find((l) => l.id === labelId)
      if (!current) throw labelNotFound()
      const value = checked({
        name: input.name ?? current.name,
        color: input.color ?? current.color,
      })
      const result = await tx.contentSettings.updateLabel(scope, labelId, value)
      if (result === 'missing') throw labelNotFound()
      if (result === 'taken') throw nameTaken()
      return toDto({ ...current, ...value })
    },
  )
}

export async function deleteLabel(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; labelId: string },
): Promise<void> {
  await deps.uow.run({ organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const { scope } = await openContentSettings(tx, actor, input.workspaceId, { write: true })
    const labelId = knownId(input.labelId, labelNotFound)
    if (!(await tx.contentSettings.deleteLabel(scope, labelId))) throw labelNotFound()
  })
}

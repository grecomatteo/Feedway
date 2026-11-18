import {
  DomainError,
  validateCaptionTemplate,
  type CaptionTemplateKind,
  type OrgActor,
} from '@app/domain'
import type { CaptionTemplateRecord } from '../ports/content-settings.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { CONTENT_SETTINGS_MAX, knownId, openContentSettings, tooMany } from './content-settings.js'

// The caption templates of a workspace (spec §11.7, plan 06 Task 7): a text, a signature or a
// set of hashtags that «Inserisci» puts where the cursor is.

export interface CaptionTemplateDto {
  id: string
  kind: CaptionTemplateKind
  name: string
  body: string
  updatedAt: string
}

const toDto = (t: CaptionTemplateRecord): CaptionTemplateDto => ({
  id: t.id,
  kind: t.kind,
  name: t.name,
  body: t.body,
  updatedAt: t.updatedAt.toISOString(),
})

export const templateNotFound = () => new DomainError('NOT_FOUND', 'Modello non trovato')

const MESSAGES = {
  kind: 'Scegli se è un testo, una firma o degli hashtag',
  name: 'Il nome del modello va da 1 a 80 caratteri, senza link',
  body: 'Il testo del modello va da 1 a 2.200 caratteri',
} as const

function checked(raw: { kind: string; name: string; body: string }) {
  const result = validateCaptionTemplate(raw)
  if (!result.ok)
    throw new DomainError('VALIDATION', MESSAGES[result.field], { field: result.field })
  return result.value
}

export async function listCaptionTemplates(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string },
): Promise<{ items: CaptionTemplateDto[] }> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { scope } = await openContentSettings(tx, actor, input.workspaceId, { write: false })
      return { items: (await tx.contentSettings.listTemplates(scope)).map(toDto) }
    },
  )
}

export async function createCaptionTemplate(
  deps: { uow: UnitOfWork; ids: IdGenerator },
  actor: OrgActor,
  input: { workspaceId: string; kind: string; name: string; body: string },
): Promise<CaptionTemplateDto> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { scope } = await openContentSettings(tx, actor, input.workspaceId, { write: true })
      const value = checked(input)
      if ((await tx.contentSettings.countTemplates(scope)) >= CONTENT_SETTINGS_MAX)
        throw tooMany('modelli')
      const id = deps.ids.newId()
      await tx.contentSettings.insertTemplate(scope, { id, ...value })
      const created = (await tx.contentSettings.listTemplates(scope)).find((t) => t.id === id)
      if (!created) throw templateNotFound()
      return toDto(created)
    },
  )
}

export async function updateCaptionTemplate(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; templateId: string; kind?: string; name?: string; body?: string },
): Promise<CaptionTemplateDto> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { scope } = await openContentSettings(tx, actor, input.workspaceId, { write: true })
      const templateId = knownId(input.templateId, templateNotFound)
      const all = await tx.contentSettings.listTemplates(scope)
      const current = all.find((t) => t.id === templateId)
      if (!current) throw templateNotFound()
      const value = checked({
        kind: input.kind ?? current.kind,
        name: input.name ?? current.name,
        body: input.body ?? current.body,
      })
      if (!(await tx.contentSettings.updateTemplate(scope, templateId, value)))
        throw templateNotFound()
      const updated = (await tx.contentSettings.listTemplates(scope)).find(
        (t) => t.id === templateId,
      )
      if (!updated) throw templateNotFound()
      return toDto(updated)
    },
  )
}

export async function deleteCaptionTemplate(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; templateId: string },
): Promise<void> {
  await deps.uow.run({ organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const { scope } = await openContentSettings(tx, actor, input.workspaceId, { write: true })
    const templateId = knownId(input.templateId, templateNotFound)
    if (!(await tx.contentSettings.deleteTemplate(scope, templateId))) throw templateNotFound()
  })
}

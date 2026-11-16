import {
  DomainError,
  FOLDER_MAX_DEPTH,
  MAX_FOLDERS,
  folderHeight,
  folderName,
  folderPath,
  folderWouldLoop,
  normalizeTags,
  type OrgActor,
} from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { LibraryFolderRecord } from '../ports/media.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { assertActiveOrganization } from '../workspaces/index.js'
import { type MediaDto, liveMedia, openLibrary, toDto } from './library.js'

// The folders and the tags of a workspace's library (spec §11.8, plan 04 Task 12). Whoever may
// use the library (`media.upload`, Editor and above) arranges it; for anyone else it does not
// exist (404). A client archived is read only.

export interface FolderDto {
  id: string
  name: string
  parentId: string | null
  /** files right inside it */
  fileCount: number
  createdAt: string
}

const toFolderDto = (f: LibraryFolderRecord): FolderDto => ({
  id: f.id,
  name: f.name,
  parentId: f.parentId,
  fileCount: f.fileCount,
  createdAt: f.createdAt.toISOString(),
})

export const folderNotFound = () => new DomainError('NOT_FOUND', 'Cartella non trovata')

const nameTaken = () =>
  new DomainError('CONFLICT', 'C’è già una cartella con questo nome nello stesso posto', {
    field: 'name',
  })

/** The library open for changes: the agency active, the client not archived. */
async function openForChanges(tx: Tx, actor: OrgActor, workspaceId: string) {
  const opened = await openLibrary(tx, actor, workspaceId)
  await assertActiveOrganization(tx, actor.organizationId)
  if (opened.workspace.archivedAt !== null)
    throw new DomainError('CONFLICT', 'Il cliente è archiviato: la sua libreria non si modifica')
  return opened
}

/** As `openForChanges`, and the folders locked: two moves at once never make a loop. */
async function openFoldersForChanges(tx: Tx, actor: OrgActor, workspaceId: string) {
  const opened = await openForChanges(tx, actor, workspaceId)
  await tx.media.lockFolders(actor.organizationId, opened.workspace.id)
  return opened
}

/** A folder of the workspace as a parent or a target: null is the top of the library. */
function knownFolder(folders: readonly LibraryFolderRecord[], id: string | null) {
  if (id === null) return null
  if (!isUuid(id)) throw folderNotFound()
  const found = folders.find((f) => f.id === id)
  if (!found) throw folderNotFound()
  return found
}

const tooDeep = () =>
  new DomainError(
    'VALIDATION',
    `Le cartelle si annidano al massimo su ${String(FOLDER_MAX_DEPTH)} livelli`,
    { field: 'parentId' },
  )

export async function listFolders(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string },
): Promise<{ items: FolderDto[] }> {
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { workspace } = await openLibrary(tx, actor, input.workspaceId)
    const folders = await tx.media.listFolders(organizationId, workspace.id)
    return { items: folders.map(toFolderDto) }
  })
}

export async function createFolder(
  deps: { uow: UnitOfWork; ids: IdGenerator },
  actor: OrgActor,
  input: { workspaceId: string; name: string; parentId: string | null },
): Promise<FolderDto> {
  const { organizationId } = actor
  const name = folderName(input.name)
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { workspace } = await openFoldersForChanges(tx, actor, input.workspaceId)
    const folders = await tx.media.listFolders(organizationId, workspace.id)
    knownFolder(folders, input.parentId)
    if (folders.length >= MAX_FOLDERS)
      throw new DomainError(
        'CONFLICT',
        `Una libreria può avere al massimo ${String(MAX_FOLDERS)} cartelle`,
      )
    if (folderPath(folders, input.parentId).length + 1 > FOLDER_MAX_DEPTH) throw tooDeep()
    const id = deps.ids.newId()
    const created = await tx.media.createFolder({
      id,
      organizationId,
      workspaceId: workspace.id,
      name,
      parentId: input.parentId,
    })
    if (created === 'taken') throw nameTaken()
    const all = await tx.media.listFolders(organizationId, workspace.id)
    const folder = all.find((f) => f.id === id)
    if (!folder) throw folderNotFound()
    return toFolderDto(folder)
  })
}

/** Renames a folder, or moves it into another one (`parentId`, null: to the top). */
export async function updateFolder(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; folderId: string; name?: string; parentId?: string | null },
): Promise<FolderDto> {
  const { organizationId } = actor
  const name = input.name === undefined ? undefined : folderName(input.name)
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { workspace } = await openFoldersForChanges(tx, actor, input.workspaceId)
    const folders = await tx.media.listFolders(organizationId, workspace.id)
    const folder = knownFolder(folders, input.folderId)
    if (!folder) throw folderNotFound()
    if (input.parentId !== undefined) {
      knownFolder(folders, input.parentId)
      if (folderWouldLoop(folders, folder.id, input.parentId))
        throw new DomainError(
          'VALIDATION',
          'Una cartella non può andare dentro sé stessa o una sua sottocartella',
          { field: 'parentId' },
        )
      const depth = folderPath(folders, input.parentId).length + folderHeight(folders, folder.id)
      if (depth > FOLDER_MAX_DEPTH) throw tooDeep()
    }
    const result = await tx.media.updateFolder(organizationId, workspace.id, folder.id, {
      ...(name === undefined ? {} : { name }),
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
    })
    if (result === 'taken') throw nameTaken()
    if (result === 'missing') throw folderNotFound()
    const all = await tx.media.listFolders(organizationId, workspace.id)
    const updated = all.find((f) => f.id === folder.id)
    if (!updated) throw folderNotFound()
    return toFolderDto(updated)
  })
}

/**
 * Deletes a folder. An empty one goes at once; one with files or folders inside only with
 * `confirm`, and what it holds goes up into its parent: no file is deleted (plan 04 Task 12).
 */
export async function deleteFolder(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; folderId: string; confirm: boolean },
): Promise<void> {
  const { organizationId } = actor
  await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { workspace } = await openFoldersForChanges(tx, actor, input.workspaceId)
    const folders = await tx.media.listFolders(organizationId, workspace.id)
    const folder = knownFolder(folders, input.folderId)
    if (!folder) throw folderNotFound()
    const subfolders = folders.filter((f) => f.parentId === folder.id).length
    if (!input.confirm && (folder.fileCount > 0 || subfolders > 0))
      throw new DomainError(
        'CONFLICT',
        'La cartella non è vuota: conferma, e quello che contiene passa nella cartella sopra',
        { files: folder.fileCount, folders: subfolders },
      )
    const result = await tx.media.deleteFolder(organizationId, workspace.id, folder.id)
    if (result === 'missing') throw folderNotFound()
    if (result === 'taken')
      throw new DomainError(
        'CONFLICT',
        'Una sottocartella ha lo stesso nome di una cartella del posto sopra: rinominala prima',
      )
  })
}

/** Moves a file into a folder (null: out of any) and sets its tags. */
export async function updateMedia(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; mediaId: string; folderId?: string | null; tags?: string[] },
): Promise<MediaDto> {
  const { organizationId } = actor
  const tags = input.tags === undefined ? undefined : normalizeTags(input.tags)
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const { workspace } = await openForChanges(tx, actor, input.workspaceId)
    const found = await liveMedia(tx, organizationId, workspace.id, input.mediaId)
    if (input.folderId !== undefined && input.folderId !== null) {
      if (
        !isUuid(input.folderId) ||
        !(await tx.media.folderExists(organizationId, workspace.id, input.folderId))
      )
        throw folderNotFound()
    }
    await tx.media.setLibraryEntry(organizationId, workspace.id, found.id, {
      ...(input.folderId === undefined ? {} : { folderId: input.folderId }),
      ...(tags === undefined ? {} : { tags }),
    })
    const updated = await liveMedia(tx, organizationId, workspace.id, found.id)
    return toDto(updated, await tx.media.variantsOf(organizationId, [found.id]))
  })
}

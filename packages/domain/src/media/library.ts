import { DomainError } from '../errors.js'

// The library of a workspace (spec §11.8, plan 04 Task 12): nested folders and free tags.

export const FOLDER_NAME_MAX_LENGTH = 80
/** Levels of folders, the top one included: deeper trees are hard to use from a phone. */
export const FOLDER_MAX_DEPTH = 5
/** Folders in one workspace. */
export const MAX_FOLDERS = 500
export const MAX_TAGS = 20
export const TAG_MAX_LENGTH = 40

// eslint-disable-next-line no-control-regex -- control characters are what it refuses
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

const squeeze = (value: string) => value.trim().replace(/\s+/g, ' ')

/** A folder's name as stored: trimmed, single spaces; VALIDATION when unusable. */
export function folderName(input: string): string {
  const name = squeeze(input)
  if (
    name === '' ||
    name.length > FOLDER_NAME_MAX_LENGTH ||
    CONTROL.test(input) ||
    name.includes('/')
  )
    throw new DomainError(
      'VALIDATION',
      `Il nome della cartella va da 1 a ${String(FOLDER_NAME_MAX_LENGTH)} caratteri, senza «/»`,
      { field: 'name' },
    )
  return name
}

/**
 * A file's tags as stored: trimmed, single spaces, lowercase, each once, in the order given.
 * Empty ones are dropped; VALIDATION for one too long, with a control character, or too many.
 */
export function normalizeTags(input: readonly string[]): string[] {
  const tags: string[] = []
  for (const raw of input) {
    if (CONTROL.test(raw))
      throw new DomainError('VALIDATION', 'Un tag non può contenere caratteri di controllo', {
        field: 'tags',
      })
    const tag = squeeze(raw).toLocaleLowerCase('it')
    if (tag === '') continue
    if (tag.length > TAG_MAX_LENGTH)
      throw new DomainError(
        'VALIDATION',
        `Un tag può avere al massimo ${String(TAG_MAX_LENGTH)} caratteri`,
        { field: 'tags' },
      )
    if (!tags.includes(tag)) tags.push(tag)
  }
  if (tags.length > MAX_TAGS)
    throw new DomainError('VALIDATION', `Un file può avere al massimo ${String(MAX_TAGS)} tag`, {
      field: 'tags',
    })
  return tags
}

export interface FolderLink {
  id: string
  parentId: string | null
}

/** The folders from `id` up to the top, `id` first; stops at a loop the data should not have. */
export function folderPath(folders: readonly FolderLink[], id: string | null): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const path: string[] = []
  let at = id
  while (at !== null && !path.includes(at)) {
    path.push(at)
    at = byId.get(at)?.parentId ?? null
  }
  return path
}

/** Whether moving `folderId` into `parentId` would put it inside itself. */
export function folderWouldLoop(
  folders: readonly FolderLink[],
  folderId: string,
  parentId: string | null,
): boolean {
  return folderPath(folders, parentId).includes(folderId)
}

/** How many levels the folder's own tree has below it, itself included (1: no subfolders). */
export function folderHeight(folders: readonly FolderLink[], folderId: string): number {
  const children = folders.filter((f) => f.parentId === folderId)
  return 1 + Math.max(0, ...children.map((c) => folderHeight(folders, c.id)))
}

// What a folder or a zip becomes in the library (D-104, D-110): the folders to create under the
// one chosen and the files to send into each, before anything is sent. The paths come from the
// person's computer or from a zip someone else made, so they are checked first: one path that
// climbs out (`..`), starts at the root or names a drive refuses the whole set.
import { FOLDER_MAX_DEPTH, FOLDER_NAME_MAX_LENGTH, MAX_FOLDERS, folderName } from '@app/domain'
import { checkUploadFile, type UploadLimits } from './upload-file.ts'

/** Files in one upload of a folder or a zip (D-110). */
export const TREE_MAX_FILES = 150

export interface TreeItem {
  /** the path inside the folder or the zip, the folder itself first (`novembre/reel/a.mp4`) */
  path: string
  size: number
  type?: string
}

export interface ExistingFolder {
  id: string
  name: string
  parentId: string | null
}

export interface PlannedFolder {
  /** the folder's path in the plan, lowercase: the key its files and subfolders point to */
  key: string
  name: string
  /** null: right under the folder chosen */
  parentKey: string | null
  /** a folder already there that this one joins («Unisci») */
  existingId: string | null
}

export interface PlannedFile<T> {
  item: T
  /** the file's own name, without the folders */
  name: string
  /** null: into the folder chosen itself */
  folderKey: string | null
}

export type SkipReason = 'system' | 'hidden' | 'type' | 'empty' | 'size'

export interface TreePlan<T> {
  folders: PlannedFolder[]
  files: PlannedFile<T>[]
  skipped: { path: string; reason: SkipReason }[]
  bytes: number
  /** the names, under the folder chosen, that are already there */
  clashes: string[]
}

export type TreeProblem =
  | { problem: 'unsafe'; path: string }
  | { problem: 'name'; name: string }
  | { problem: 'files'; count: number; max: number }
  | { problem: 'depth'; path: string; max: number }
  | { problem: 'folders'; count: number; max: number }
  | { problem: 'empty' }

export class TreeError extends Error {
  constructor(readonly detail: TreeProblem) {
    super(`tree: ${detail.problem}`)
  }
}

/** What macOS and Windows add by themselves: never the person's files. */
const SYSTEM = new Set(['__macosx', '.ds_store', 'thumbs.db', 'desktop.ini'])

/** `\` as `/`, one way of writing each letter (NFC), no empty pieces; throws on an unsafe path. */
export function splitPath(raw: string): string[] {
  const path = raw.normalize('NFC').replace(/\\/g, '/')
  if (path.startsWith('/') || /^[a-z]:/i.test(path))
    throw new TreeError({ problem: 'unsafe', path: raw })
  const parts = path.split('/').filter((p) => p !== '' && p !== '.')
  if (parts.includes('..')) throw new TreeError({ problem: 'unsafe', path: raw })
  return parts
}

const lower = (name: string) => name.toLocaleLowerCase('it')

/** «novembre (2)», the first number free among `taken` (lowercase), within the name's length. */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  for (let n = 2; ; n++) {
    const tail = ` (${String(n)})`
    const candidate = `${name.slice(0, FOLDER_NAME_MAX_LENGTH - tail.length).trimEnd()}${tail}`
    if (!taken.has(lower(candidate))) return candidate
  }
}

/** Levels from the top to `id` included: 0 for «Tutti i file». */
function depthOf(folders: readonly ExistingFolder[], id: string | null): number {
  const byId = new Map(folders.map((f) => [f.id, f]))
  let depth = 0
  for (
    let f = id === null ? undefined : byId.get(id);
    f;
    f = f.parentId === null ? undefined : byId.get(f.parentId)
  )
    depth += 1
  return depth
}

/**
 * The plan for `items` under the folder `targetId` (null: no folder). `merge` joins the folders
 * that are already there with the same name («Unisci»); otherwise a new one is made beside it,
 * «novembre (2)». Throws a `TreeError` when the whole set cannot go.
 */
export function planTree<T extends TreeItem>(
  items: readonly T[],
  opts: {
    existing: readonly ExistingFolder[]
    targetId: string | null
    merge: boolean
    limits: UploadLimits
  },
): TreePlan<T> {
  const split = items.map((item) => ({ item, parts: splitPath(item.path) }))

  const skipped: TreePlan<T>['skipped'] = []
  const kept: { item: T; dirs: string[]; name: string }[] = []
  for (const { item, parts } of split) {
    const name = parts.at(-1)
    if (!name) continue
    if (parts.some((p) => SYSTEM.has(lower(p)))) skipped.push({ path: item.path, reason: 'system' })
    else if (parts.some((p) => p.startsWith('.')))
      skipped.push({ path: item.path, reason: 'hidden' })
    else {
      const check = checkUploadFile({ name, type: item.type ?? '', size: item.size }, opts.limits)
      if (check.ok) kept.push({ item, dirs: parts.slice(0, -1), name })
      else skipped.push({ path: item.path, reason: check.reason })
    }
  }
  // in the order of the names: a folder's files come in no order of their own
  skipped.sort((a, b) => a.path.localeCompare(b.path))
  if (kept.length === 0) throw new TreeError({ problem: 'empty' })
  if (kept.length > TREE_MAX_FILES)
    throw new TreeError({ problem: 'files', count: kept.length, max: TREE_MAX_FILES })

  const base = depthOf(opts.existing, opts.targetId)
  const children = (parentId: string | null) => opts.existing.filter((f) => f.parentId === parentId)
  const folders = new Map<string, PlannedFolder>()
  const clashes = new Set<string>()

  /** The key of the folder `dirs`, creating it and those above it in the plan. */
  function folderFor(dirs: readonly string[], path: string): string | null {
    let parent = null as PlannedFolder | null
    for (const [level, raw] of dirs.entries()) {
      let name: string
      try {
        name = folderName(raw)
      } catch {
        throw new TreeError({ problem: 'name', name: raw })
      }
      if (base + level + 1 > FOLDER_MAX_DEPTH)
        throw new TreeError({ problem: 'depth', path, max: FOLDER_MAX_DEPTH })
      const key: string = parent === null ? lower(name) : `${parent.key}/${lower(name)}`
      let folder = folders.get(key)
      if (!folder) {
        // the folders already there beside it: under the target, or under a folder joined
        const beside: readonly ExistingFolder[] =
          parent === null
            ? children(opts.targetId)
            : parent.existingId
              ? children(parent.existingId)
              : []
        const same = beside.find((f) => lower(f.name) === lower(name))
        let existingId: string | null = null
        if (same) {
          if (parent === null) clashes.add(same.name)
          if (opts.merge) existingId = same.id
          else name = freeName(name, new Set(beside.map((f) => lower(f.name))))
        }
        folder = { key, name, parentKey: parent?.key ?? null, existingId }
        folders.set(key, folder)
      }
      parent = folder
    }
    return parent?.key ?? null
  }

  const files = kept.map(({ item, dirs, name }) => ({
    item,
    name,
    folderKey: folderFor(dirs, item.path),
  }))

  const created = [...folders.values()].filter((f) => !f.existingId).length
  if (opts.existing.length + created > MAX_FOLDERS)
    throw new TreeError({
      problem: 'folders',
      count: opts.existing.length + created,
      max: MAX_FOLDERS,
    })

  return {
    folders: [...folders.values()],
    files,
    skipped,
    bytes: kept.reduce((sum, k) => sum + k.item.size, 0),
    clashes: [...clashes],
  }
}

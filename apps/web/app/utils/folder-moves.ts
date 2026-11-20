import { FOLDER_MAX_DEPTH } from '@app/domain'

interface FolderLink {
  id: string
  parentId: string | null
}

/**
 * Where a folder can go with «Sposta» (D-103): null is the top of the library. Never the folder
 * itself, a folder below it or the place it is in already, and only where it and everything under
 * it stay within the levels the server allows (`FOLDER_MAX_DEPTH`), so the menu offers no move
 * the server would refuse. In the order of `folders`.
 */
export function folderMoveTargets(folders: readonly FolderLink[], id: string): (string | null)[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const moving = byId.get(id)
  if (!moving) return []
  const below = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of folders)
      if (f.parentId !== null && below.has(f.parentId) && !below.has(f.id)) {
        below.add(f.id)
        grew = true
      }
  }
  const height = (at: string): number =>
    1 + Math.max(0, ...folders.filter((f) => f.parentId === at).map((f) => height(f.id)))
  const depth = (at: string | null): number => {
    let n = 0
    for (let f = at === null ? undefined : byId.get(at); f; f = byId.get(f.parentId ?? '')) n++
    return n
  }
  const tall = height(id)
  return [null, ...folders.map((f) => f.id)].filter(
    (target) =>
      target !== moving.parentId &&
      (target === null || !below.has(target)) &&
      depth(target) + tall <= FOLDER_MAX_DEPTH,
  )
}

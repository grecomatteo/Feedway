import { describe, expect, it } from 'vitest'
import { folderMoveTargets } from '../app/utils/folder-moves.ts'

// a ─ b ─ c, d, e ─ f ─ g ─ h (four levels under e)
const folders = [
  { id: 'a', parentId: null },
  { id: 'b', parentId: 'a' },
  { id: 'c', parentId: 'b' },
  { id: 'd', parentId: null },
  { id: 'e', parentId: null },
  { id: 'f', parentId: 'e' },
  { id: 'g', parentId: 'f' },
  { id: 'h', parentId: 'g' },
]

describe('folderMoveTargets («Sposta» of a folder)', () => {
  it('never the folder itself, nor a folder below it, nor where it already is', () => {
    expect(folderMoveTargets(folders, 'a')).toEqual(['d', 'e', 'f'])
  })

  it('the top of the library (null) when the folder is inside another', () => {
    expect(folderMoveTargets(folders, 'c')).toContain(null)
    expect(folderMoveTargets(folders, 'c')).not.toContain('b')
  })

  it('only where the folder and what is under it stay within five levels', () => {
    // e has four levels: only under a folder at the first level
    expect(folderMoveTargets(folders, 'e')).toEqual(['a', 'd'])
    // g has two levels: under a folder at most three levels deep
    expect(folderMoveTargets(folders, 'g')).toEqual([null, 'a', 'b', 'c', 'd', 'e'])
  })
})

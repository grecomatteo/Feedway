import { describe, expect, it } from 'vitest'
import {
  TREE_MAX_FILES,
  TreeError,
  freeName,
  planTree,
  splitPath,
  type ExistingFolder,
} from '../app/utils/upload-tree.ts'

const limits = { maxImageBytes: 1000, maxVideoBytes: 5000 }
const file = (path: string, size = 10) => ({ path, size })
const plan = (
  paths: (string | { path: string; size: number })[],
  opts: Partial<{ existing: ExistingFolder[]; targetId: string | null; merge: boolean }> = {},
) =>
  planTree(
    paths.map((p) => (typeof p === 'string' ? file(p) : p)),
    { existing: [], targetId: null, merge: false, limits, ...opts },
  )
const problemOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    if (error instanceof TreeError) return error.detail
    throw error
  }
  return null
}

describe('splitPath', () => {
  it('writes every path one way: «/», NFC, no empty or «.» pieces', () => {
    expect(splitPath('novembre\\reel\\a.mp4')).toEqual(['novembre', 'reel', 'a.mp4'])
    expect(splitPath('./a//b/c.jpg')).toEqual(['a', 'b', 'c.jpg'])
    // «é» written as e + combining accent (macOS) is the same name as «é»
    expect(splitPath('caffe\u0301/x.jpg')[0]).toBe('caffé')
  })

  it('refuses a path that climbs out, starts at the root or names a drive', () => {
    for (const path of [
      '../x.jpg',
      'a/../../x.jpg',
      'a\\..\\x.jpg',
      '/etc/x.jpg',
      'C:/x.jpg',
      'c:x.jpg',
    ])
      expect(problemOf(() => splitPath(path))).toEqual({ problem: 'unsafe', path })
  })
})

describe('planTree (a folder or a zip into the library)', () => {
  it('makes each folder once, parents first, and puts the files in theirs', () => {
    const p = plan(['novembre/a.jpg', 'novembre/reel/b.mp4', 'novembre/reel/c.mp4', 'd.png'])
    expect(p.folders).toEqual([
      { key: 'novembre', name: 'novembre', parentKey: null, existingId: null },
      { key: 'novembre/reel', name: 'reel', parentKey: 'novembre', existingId: null },
    ])
    expect(p.files.map((f) => [f.name, f.folderKey])).toEqual([
      ['a.jpg', 'novembre'],
      ['b.mp4', 'novembre/reel'],
      ['c.mp4', 'novembre/reel'],
      ['d.png', null],
    ])
    expect(p.bytes).toBe(40)
    expect(p.clashes).toEqual([])
  })

  it('leaves out what macOS and Windows add, hidden files and what is not a photo or a video', () => {
    const p = plan([
      'novembre/a.jpg',
      '__MACOSX/novembre/._a.jpg',
      'novembre/.DS_Store',
      'novembre/Thumbs.db',
      'novembre/.bozze/b.jpg',
      'novembre/note.txt',
      { path: 'novembre/vuota.jpg', size: 0 },
      { path: 'novembre/grande.jpg', size: 2000 },
    ])
    expect(p.files.map((f) => f.name)).toEqual(['a.jpg'])
    const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path)
    // in the order of the names
    expect(p.skipped).toEqual(
      [
        { path: '__MACOSX/novembre/._a.jpg', reason: 'system' },
        { path: 'novembre/.DS_Store', reason: 'system' },
        { path: 'novembre/Thumbs.db', reason: 'system' },
        { path: 'novembre/.bozze/b.jpg', reason: 'hidden' },
        { path: 'novembre/note.txt', reason: 'type' },
        { path: 'novembre/vuota.jpg', reason: 'empty' },
        { path: 'novembre/grande.jpg', reason: 'size' },
      ].sort(byPath),
    )
    // no folder for the files left out
    expect(p.folders.map((f) => f.key)).toEqual(['novembre'])
  })

  it('refuses the whole set when one path is unsafe', () => {
    expect(problemOf(() => plan(['novembre/a.jpg', 'novembre/../../b.jpg']))).toEqual({
      problem: 'unsafe',
      path: 'novembre/../../b.jpg',
    })
  })

  it('one folder for names that differ only in capitals, as the library does', () => {
    const p = plan(['Reel/a.mp4', 'reel/b.mp4', 'REEL/c.mp4'])
    expect(p.folders).toHaveLength(1)
    expect(p.folders[0]?.name).toBe('Reel')
    expect(new Set(p.files.map((f) => f.folderKey))).toEqual(new Set(['reel']))
  })

  it('folder names follow the library: spaces squeezed, at most 80 characters', () => {
    expect(plan(['  due   spazi /a.jpg']).folders[0]?.name).toBe('due spazi')
    const long = 'x'.repeat(81)
    expect(problemOf(() => plan([`${long}/a.jpg`]))).toEqual({ problem: 'name', name: long })
  })

  it(`at most ${String(TREE_MAX_FILES)} files, counting only those that go`, () => {
    const many = Array.from({ length: TREE_MAX_FILES }, (_, i) => `a/${String(i)}.jpg`)
    expect(plan([...many, 'a/x.txt']).files).toHaveLength(TREE_MAX_FILES)
    expect(problemOf(() => plan([...many, 'a/one-more.jpg']))).toEqual({
      problem: 'files',
      count: TREE_MAX_FILES + 1,
      max: TREE_MAX_FILES,
    })
  })

  it('nothing to send is a problem, not an empty upload', () => {
    expect(problemOf(() => plan(['__MACOSX/x', 'a/note.txt']))).toEqual({ problem: 'empty' })
  })

  it('five levels at most, counted from the folder chosen', () => {
    expect(plan(['1/2/3/4/5/a.jpg']).folders).toHaveLength(5)
    expect(problemOf(() => plan(['1/2/3/4/5/6/a.jpg']))).toEqual({
      problem: 'depth',
      path: '1/2/3/4/5/6/a.jpg',
      max: 5,
      left: 5,
    })
    const existing = [
      { id: 'top', name: 'Clienti', parentId: null },
      { id: 'mid', name: '2026', parentId: 'top' },
    ]
    expect(plan(['1/2/3/a.jpg'], { existing, targetId: 'mid' }).folders).toHaveLength(3)
    expect(problemOf(() => plan(['1/2/3/4/a.jpg'], { existing, targetId: 'mid' }))).toMatchObject({
      problem: 'depth',
      left: 3,
    })
  })

  it('at most 500 folders in the client, those there already counted', () => {
    const existing = Array.from({ length: 499 }, (_, i) => ({
      id: String(i),
      name: `f${String(i)}`,
      parentId: null,
    }))
    expect(plan(['nuova/a.jpg'], { existing }).folders).toHaveLength(1)
    expect(problemOf(() => plan(['nuova/a.jpg', 'altra/b.jpg'], { existing }))).toEqual({
      problem: 'folders',
      count: 501,
      max: 500,
    })
  })

  describe('a folder with the same name already there', () => {
    const existing = [
      { id: 'n', name: 'Novembre', parentId: null },
      { id: 'n2', name: 'novembre (2)', parentId: null },
      { id: 'r', name: 'Reel', parentId: 'n' },
      { id: 'other', name: 'novembre', parentId: 'elsewhere' },
    ]

    it('says which, and makes «novembre (3)» beside it', () => {
      const p = plan(['novembre/reel/a.mp4'], { existing })
      expect(p.clashes).toEqual(['Novembre'])
      expect(p.folders).toEqual([
        { key: 'novembre', name: 'novembre (3)', parentKey: null, existingId: null },
        { key: 'novembre/reel', name: 'reel', parentKey: 'novembre', existingId: null },
      ])
    })

    it('a folder of the set with the name a renamed one took gets a number too', () => {
      const p = plan(['novembre/a.jpg', 'Novembre (3)/b.jpg'], { existing })
      expect(p.folders.map((f) => f.name)).toEqual(['novembre (3)', 'Novembre (3) (2)'])
    })

    it('«Unisci» joins it, and the folders under it with the same name', () => {
      const p = plan(['novembre/reel/a.mp4', 'novembre/copertine/b.jpg'], {
        existing,
        merge: true,
      })
      expect(p.folders).toEqual([
        { key: 'novembre', name: 'novembre', parentKey: null, existingId: 'n' },
        { key: 'novembre/reel', name: 'reel', parentKey: 'novembre', existingId: 'r' },
        { key: 'novembre/copertine', name: 'copertine', parentKey: 'novembre', existingId: null },
      ])
    })

    it('only beside the folder chosen: a «novembre» elsewhere is no clash', () => {
      expect(plan(['novembre/a.jpg'], { existing, targetId: 'r' }).clashes).toEqual([])
    })
  })
})

describe('freeName', () => {
  it('the first number free, within 80 characters', () => {
    expect(freeName('a', new Set(['a', 'a (2)']))).toBe('a (3)')
    const long = 'x'.repeat(80)
    const name = freeName(long, new Set([long]))
    expect(name).toHaveLength(80)
    expect(name.endsWith(' (2)')).toBe(true)
  })
})

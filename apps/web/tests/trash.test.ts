import { describe, expect, it } from 'vitest'
import { mayTrash, trashBatches, trashNote } from '../app/utils/trash.ts'

const me = 'u-me'
const post = (over: Record<string, unknown> = {}) => ({
  status: 'draft' as 'draft' | 'scheduled' | 'cancelled',
  createdBy: me,
  trashedAt: null as string | null,
  autoTrashAt: null as string | null,
  ...over,
})
const client = (over: Record<string, unknown> = {}) => ({
  myRole: 'editor',
  archivedAt: null as string | null,
  ...over,
})

describe('mayTrash (plan 09 Scelta 12)', () => {
  it('takes one’s own draft or cancelled post', () => {
    expect(mayTrash(post(), client(), me)).toBe(true)
    expect(mayTrash(post({ status: 'cancelled' }), client(), me)).toBe(true)
    expect(mayTrash(post({ status: 'scheduled' }), client({ myRole: 'owner' }), me)).toBe(false)
  })

  it('takes someone else’s only for who manages the posts of others', () => {
    expect(mayTrash(post({ createdBy: 'u-other' }), client(), me)).toBe(false)
    expect(mayTrash(post({ createdBy: 'u-other' }), client({ myRole: 'manager' }), me)).toBe(true)
  })

  it('never for a Viewer, an archived client or a post already in «Eliminati»', () => {
    expect(mayTrash(post(), client({ myRole: 'viewer' }), me)).toBe(false)
    expect(mayTrash(post(), client({ archivedAt: '2026-11-01T00:00:00Z' }), me)).toBe(false)
    expect(mayTrash(post({ trashedAt: '2026-11-20T00:00:00Z' }), client(), me)).toBe(false)
    expect(mayTrash(post(), undefined, me)).toBe(false)
  })
})

describe('trashNote', () => {
  const now = new Date('2026-11-27T10:00:00Z')
  it('says when a post in «Eliminati» goes for good', () => {
    expect(trashNote(post({ trashedAt: '2026-11-20T10:00:00Z' }), now)).toEqual({
      key: 'trash.purgeIn',
      n: 23,
    })
  })

  it('warns of a draft that goes to «Eliminati» within 7 days, not before', () => {
    expect(trashNote(post({ autoTrashAt: '2026-12-02T09:00:00Z' }), now)).toEqual({
      key: 'trash.autoTrashIn',
      n: 5,
    })
    expect(trashNote(post({ autoTrashAt: '2026-12-10T10:00:00Z' }), now)).toBeNull()
    // already due: it goes with the night's clean-up
    expect(trashNote(post({ autoTrashAt: '2026-11-26T10:00:00Z' }), now)).toEqual({
      key: 'trash.autoTrashIn',
      n: 0,
    })
    expect(trashNote(post(), now)).toBeNull()
  })
})

describe('trashBatches', () => {
  it('groups by client, once each, at most 100 per request', () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ id: `p${String(i)}`, workspaceId: 'a' }))
    const out = trashBatches([
      ...many,
      { id: 'q', workspaceId: 'b' },
      { id: 'p0', workspaceId: 'a' },
    ])
    expect(out.map((b) => [b.workspaceId, b.ids.length])).toEqual([
      ['a', 100],
      ['a', 50],
      ['b', 1],
    ])
  })
})

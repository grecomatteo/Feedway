import { expect, test } from 'vitest'
import type { Translate } from '../ports/translator.js'
import type { Tx } from '../ports/tx.js'
import { postHeadline, postTitles } from './notification-messages.js'

test('the start of a post is its first line, cut at 60 characters', () => {
  expect(postHeadline('  Pane caldo alle 18\nseconda riga')).toBe('Pane caldo alle 18')
  expect(postHeadline('   \n  ')).toBeNull()
  const long = 'a'.repeat(80)
  expect(postHeadline(long)).toBe(`${'a'.repeat(59)}…`)
})

// R7: a post without text is named as in the panel's rows (D-120.7); the Viewer sees no file (D-72)
const ORG = '00000000-0000-7000-8000-000000000001'
const CLIENT = '00000000-0000-7000-8000-000000000002'
const t: Translate = (key, values) =>
  key === 'posts.type.story'
    ? 'Storia'
    : key === 'posts.list.noTextOf'
      ? `${String(values?.type)} senza testo`
      : key

function fakeTx(role: 'editor' | 'viewer', files: { id: string; status: string; name: string }[]) {
  const reads = { roles: 0, media: 0 }
  const tx = {
    orgMembers: { find: () => Promise.resolve({ status: 'active', role: 'member' }) },
    workspaceMembers: {
      rolesOf: () => {
        reads.roles += 1
        return Promise.resolve(new Map([[CLIENT, role]]))
      },
    },
    media: {
      findManyInWorkspace: () => {
        reads.media += 1
        return Promise.resolve(files.map((f) => ({ ...f, originalName: f.name })))
      },
    },
  } as unknown as Tx
  return { tx, reads }
}

const story = (over: { caption?: string; mediaIds?: string[] } = {}) => ({
  organizationId: ORG,
  workspaceId: CLIENT,
  type: 'story' as const,
  caption: '',
  mediaIds: ['a', 'b'],
  ...over,
})

test('without text: the type and the first file still in the library, the roles read once', async () => {
  const { tx, reads } = fakeTx('editor', [
    { id: 'b', status: 'ready', name: 'IMG_0234.jpg' },
    { id: 'a', status: 'deleted', name: 'IMG_0233.jpg' },
  ])
  const titleOf = postTitles(tx, t, { organizationId: ORG, userId: 'pia' })
  expect(await titleOf(story())).toBe('Storia · IMG_0234')
  expect(await titleOf(story({ caption: 'Pane caldo\naltro' }))).toBe('Pane caldo')
  expect(await titleOf(story({ mediaIds: [] }))).toBe('Storia senza testo')
  expect(await titleOf(story())).toBe('Storia · IMG_0234')
  expect(reads).toEqual({ roles: 1, media: 2 })
})

test('the Viewer, or who left the agency, reads the type only: no file is read', async () => {
  const viewer = fakeTx('viewer', [{ id: 'a', status: 'ready', name: 'IMG_0233.jpg' }])
  expect(await postTitles(viewer.tx, t, { organizationId: ORG, userId: 'v' })(story())).toBe(
    'Storia senza testo',
  )
  expect(viewer.reads.media).toBe(0)
  const gone = fakeTx('editor', [{ id: 'a', status: 'ready', name: 'IMG_0233.jpg' }])
  ;(gone.tx.orgMembers as unknown as { find: () => Promise<null> }).find = () =>
    Promise.resolve(null)
  expect(await postTitles(gone.tx, t, { organizationId: ORG, userId: 'x' })(story())).toBe(
    'Storia senza testo',
  )
})

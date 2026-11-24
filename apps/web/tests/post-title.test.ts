import { expect, test } from 'vitest'
import { postTitle } from '../app/utils/post-title.ts'

// What a row calls a post (D-120.7): its text, else its type and its first file.
const t = (key: string, named: Record<string, unknown> = {}) =>
  key === 'posts.type.story'
    ? 'Storia'
    : key === 'posts.list.noTextOf'
      ? `${String(named.type)} senza testo`
      : key

test('the text, on one line', () => {
  expect(postTitle({ text: 'Pane\n caldo', type: 'story', firstFile: 'IMG_0233' }, t)).toBe(
    'Pane caldo',
  )
})

test('without text: the type and the first file', () => {
  expect(postTitle({ text: '  ', type: 'story', firstFile: 'IMG_0233' }, t)).toBe(
    'Storia · IMG_0233',
  )
})

test('without text nor a file to name: the type', () => {
  expect(postTitle({ text: '', type: 'story', firstFile: null }, t)).toBe('Storia senza testo')
})

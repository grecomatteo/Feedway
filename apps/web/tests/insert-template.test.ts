import { describe, expect, test } from 'vitest'
import { insertTemplate } from '../app/utils/insert-template.ts'

// «Inserisci» of the caption (§11.7): a signature or hashtags on a paragraph of their own, a
// text where the cursor is (D-80.3: in the middle of the text, a new line after it too).

describe('insertTemplate', () => {
  const sign = { kind: 'signature', body: 'Forno Luce' } as const

  test('at the end of a text: a blank line before', () => {
    expect(insertTemplate('Il pane', 7, 7, sign)).toEqual({
      text: 'Il pane\n\nForno Luce',
      cursor: 19,
    })
  })

  test('in the middle of a text: a blank line before and after', () => {
    const r = insertTemplate('Il pane di oggi', 7, 7, sign)
    expect(r.text).toBe('Il pane\n\nForno Luce\n\ndi oggi')
    expect(r.cursor).toBe(19)
  })

  test('the lines already there are kept, not doubled', () => {
    expect(insertTemplate('Uno\n\nDue', 5, 5, sign).text).toBe('Uno\n\nForno Luce\n\nDue')
    expect(insertTemplate('Uno\nDue', 4, 4, sign).text).toBe('Uno\n\nForno Luce\n\nDue')
  })

  test('in an empty text, or at its start: no blank line before', () => {
    expect(insertTemplate('', 0, 0, sign).text).toBe('Forno Luce')
    expect(insertTemplate('Il pane', 0, 0, sign).text).toBe('Forno Luce\n\nIl pane')
  })

  test('a caption template goes where the cursor is, replacing the selection', () => {
    const r = insertTemplate('Il pane di oggi', 3, 7, { kind: 'caption', body: 'la focaccia' })
    expect(r).toEqual({ text: 'Il la focaccia di oggi', cursor: 14 })
  })
})

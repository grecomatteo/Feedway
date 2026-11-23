import { expect, test } from 'vitest'
import { postHeadline } from './notification-messages.js'

test('the start of a post is its first line, cut at 60 characters', () => {
  expect(postHeadline('  Pane caldo alle 18\nseconda riga')).toBe('Pane caldo alle 18')
  expect(postHeadline('   \n  ')).toBeNull()
  const long = 'a'.repeat(80)
  expect(postHeadline(long)).toBe(`${'a'.repeat(59)}…`)
})

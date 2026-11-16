import { describe, expect, test } from 'vitest'
import { displayName } from './uploads.js'

describe('displayName', () => {
  test.each([
    ['direction overrides', 'fattura‮gpj.exe', 'fatturagpj.exe'],
    ['isolates and marks', '⁦a⁩‎؜b', 'ab'],
    ['zero-width and joiners', 'fo​to‍⁠.jpg', 'foto.jpg'],
    ['line separators and BOM', '﻿video  .mp4', 'video.mp4'],
    ['control characters', 'a\u0000b\u001fc\u007fd\u0085.png', 'abcd.png'],
  ])('removes %s', (_, name, shown) => {
    expect(displayName(name)).toBe(shown)
  })

  test('keeps letters, accents and spaces', () => {
    expect(displayName('  Città 2026 – estate.jpg ')).toBe('Città 2026 – estate.jpg')
  })

  test.each(['', '​‮', 'x'.repeat(256)])('refuses %j', (name) => {
    expect(() => displayName(name)).toThrow(expect.objectContaining({ code: 'VALIDATION' }))
  })
})

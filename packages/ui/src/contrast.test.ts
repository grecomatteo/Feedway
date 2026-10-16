import { expect, test } from 'vitest'
import { contrastRatio } from './contrast.js'
import { statusTokens, themes } from './tokens.js'

test('contrast of black on white is 21', () => {
  expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
})

test('contrast of a colour with itself is 1', () => {
  expect(contrastRatio('#FF762E', '#FF762E')).toBeCloseTo(1, 5)
})

test.each(['light', 'dark'] as const)('%s theme meets WCAG AA', (theme) => {
  const t = themes[theme]
  for (const bg of ['bg', 'surface', 'surface-sunken'] as const) {
    expect(contrastRatio(t.text, t[bg])).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(t['text-muted'], t[bg])).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(t.focus, t[bg])).toBeGreaterThanOrEqual(3)
    for (const s of statusTokens) {
      expect(contrastRatio(t[s], t[bg])).toBeGreaterThanOrEqual(3)
    }
    for (const s of ['success', 'warning', 'danger', 'info'] as const) {
      expect(contrastRatio(t[s], t[`${s}-soft`])).toBeGreaterThanOrEqual(4.5)
    }
  }
  expect(contrastRatio(t['on-brand'], t.brand)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(t.text, t['brand-soft'])).toBeGreaterThanOrEqual(4.5)
})

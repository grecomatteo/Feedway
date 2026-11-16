import { expect, test } from 'vitest'
import { contrastRatio, perceptualDistance } from './contrast.js'
import { paletteIds, palettes, statusTokens } from './tokens.js'

test('contrast of black on white is 21', () => {
  expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
})

test('contrast of a colour with itself is 1', () => {
  expect(contrastRatio('#FF762E', '#FF762E')).toBeCloseTo(1, 5)
})

test('perceptual distance of a colour with itself is 0, of black and white 1', () => {
  expect(perceptualDistance('#FF762E', '#FF762E')).toBeCloseTo(0, 5)
  expect(perceptualDistance('#000000', '#FFFFFF')).toBeCloseTo(1, 2)
})

const BACKGROUNDS = [
  'bg',
  'surface',
  'surface-sunken',
  'nav-bg',
  'nav-hover',
  'paper',
  'card',
  'groove',
] as const

/** OKLab distance below which the accent could pass for a state (the closest pair today: 0.078). */
const DISTINCT_FROM_ACCENT = 0.075

const cases = paletteIds.flatMap((id) =>
  (['light', 'dark'] as const).map((mode) => [id, mode] as const),
)

test.each(cases)('%s palette, %s mode, meets WCAG AA', (id, mode) => {
  const t = palettes[id][mode]
  for (const bg of BACKGROUNDS) {
    expect(contrastRatio(t.text, t[bg]), `text on ${bg}`).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(t['text-muted'], t[bg]), `text-muted on ${bg}`).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(t.focus, t[bg]), `focus on ${bg}`).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(t['field-border'], t[bg]), `field-border on ${bg}`).toBeGreaterThanOrEqual(
      3,
    )
    for (const s of statusTokens) {
      expect(contrastRatio(t[s], t[bg]), `${s} on ${bg}`).toBeGreaterThanOrEqual(3)
    }
  }
  for (const s of ['success', 'warning', 'danger', 'info'] as const) {
    expect(contrastRatio(t[s], t[`${s}-soft`]), `${s} on ${s}-soft`).toBeGreaterThanOrEqual(4.5)
  }
  expect(contrastRatio(t['on-brand'], t.brand), 'on-brand on brand').toBeGreaterThanOrEqual(4.5)
  expect(
    contrastRatio(t['on-brand'], t['brand-hover']),
    'on-brand on hover',
  ).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(t.text, t['brand-soft']), 'text on brand-soft').toBeGreaterThanOrEqual(4.5)
})

test.each(cases)('%s palette, %s mode: states do not pass for the accent', (id, mode) => {
  const t = palettes[id][mode]
  for (const s of [...statusTokens, 'success', 'warning', 'danger', 'info'] as const) {
    expect(perceptualDistance(t.brand, t[s]), `brand and ${s}`).toBeGreaterThanOrEqual(
      DISTINCT_FROM_ACCENT,
    )
  }
})

import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { generateTokensCss } from './generate-css.js'
import { DEFAULT_PALETTE, paletteIds, palettes, themes, tokenNames } from './tokens.js'

test('committed tokens.css matches generated output', () => {
  const committed = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8')
  expect(committed).toBe(generateTokensCss(palettes))
})

test('every palette defines every token, light and dark', () => {
  for (const id of paletteIds)
    for (const mode of ['light', 'dark'] as const)
      expect(Object.keys(palettes[id][mode]).sort(), `${id} ${mode}`).toEqual(
        [...tokenNames].sort(),
      )
})

test('the default palette is Feedway with the brand kit colours', () => {
  expect(DEFAULT_PALETTE).toBe('feedway')
  expect(themes).toBe(palettes.feedway)
  expect(themes.light.brand).toBe('#FF762E')
  expect(themes.light.text).toBe('#242321')
  expect(themes.light.bg).toBe('#FBFAF8')
  expect(themes.light.surface).toBe('#FFFFFF')
  expect(themes.light['text-muted']).toBe('#625E58')
  expect(themes.dark.bg).toBe('#171615')
})

test('generated css: Feedway on :root and .dark, the others behind data-palette', () => {
  const css = generateTokensCss(palettes)
  expect(css).toContain(':root {')
  expect(css).toContain('.dark {')
  expect(css).toContain('--app-brand: #FF762E;')
  expect(css).not.toContain('[data-palette="feedway"]')
  for (const id of paletteIds.filter((p) => p !== 'feedway')) {
    expect(css).toContain(`:root[data-palette="${id}"]:not(.dark) {`)
    expect(css).toContain(`:root.dark[data-palette="${id}"] {`)
  }
})

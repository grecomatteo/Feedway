import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { generateTokensCss } from './generate-css.js'
import { themes } from './tokens.js'

test('committed tokens.css matches generated output', () => {
  const committed = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8')
  expect(committed).toBe(generateTokensCss(themes))
})

test('light and dark themes define the same tokens', () => {
  expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort())
})

test('generated css exposes --app- variables for both themes', () => {
  const css = generateTokensCss(themes)
  expect(css).toContain(':root {')
  expect(css).toContain('.dark {')
  expect(css).toContain('--app-brand: #FF762E;')
})

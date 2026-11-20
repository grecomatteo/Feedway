import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// A spacing token makes Tailwind write a utility for every sizing property with its name:
// `--spacing-block` gave `.inline-block { inline-size: 1rem }`, and every `inline-block` of the
// panel, Nuxt UI's own included, was 16 px wide (review of fidelity, R10). A token must never be
// named after a word that is already a utility on its own.
const TAKEN = [
  'block',
  'inline',
  'flex',
  'grid',
  'table',
  'contents',
  'hidden',
  'flow-root',
  'list-item',
  'auto',
  'full',
  'screen',
  'min',
  'max',
  'fit',
  'px',
  'dvh',
  'lvh',
  'svh',
]

test('no spacing token is named after a utility Tailwind already has', () => {
  const css = readFileSync(new URL('../app/assets/main.css', import.meta.url), 'utf8')
  const names = [...css.matchAll(/--spacing-([a-z0-9-]+)\s*:/g)].map((m) => m[1] ?? '')
  expect(names.length).toBeGreaterThan(0)
  expect(names.filter((n) => TAKEN.includes(n))).toEqual([])
})

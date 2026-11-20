import { describe, expect, test } from 'vitest'
import { VARIANT_RECIPE } from './media.js'
import {
  centerBox,
  fittedSize,
  parseRecipe,
  recipeKey,
  recipePurpose,
  type CopyRecipe,
} from './recipes.js'

describe('the fingerprint of a recipe', () => {
  const recipes: CopyRecipe[] = [
    { kind: 'crop', box: { x: 0.1, y: 0, width: 0.8, height: 0.5 } },
    { kind: 'pad', ratio: 0.8 },
    { kind: 'facebook' },
    { kind: 'reel', fit: 'pad' },
    { kind: 'reel', fit: 'crop' },
    { kind: 'reel', fit: 'convert' },
    { kind: 'story', trimMs: null },
    { kind: 'story', trimMs: 60_000 },
    { kind: 'frame', atMs: 12_345, fit: 'crop' },
    { kind: 'frame', atMs: 0, fit: 'pad' },
    { kind: 'cover', box: null },
    { kind: 'cover', box: { x: 0.2, y: 0.1, width: 0.6, height: 0.9 } },
  ]

  test.each(recipes.map((r) => [recipeKey(r), r] as const))('%s reads back', (key, recipe) => {
    expect(VARIANT_RECIPE.test(key)).toBe(true)
    expect(key.length).toBeLessThanOrEqual(64)
    expect(parseRecipe(recipePurpose(recipe), key)).toEqual(recipe)
  })

  test('a box is kept in ten-thousandths: under half a pixel of the master', () => {
    const key = recipeKey({ kind: 'crop', box: { x: 1 / 3, y: 0, width: 0.5, height: 1 } })
    expect(key).toBe('crop-3333-0-5000-10000')
  })

  test('a box against the edge, at an odd pixel, stays inside once rounded', () => {
    // 9 px of 1440: x and width both end in .5 ten-thousandths
    const box = { x: 9 / 1440, y: 9 / 1440, width: 1431 / 1440, height: 1431 / 1440 }
    const key = recipeKey({ kind: 'crop', box })
    expect(key).toBe('crop-63-63-9937-9937')
    expect(parseRecipe('ig_feed', key)).not.toBeNull()
  })

  test('the same choices give the same key, so two posts share one copy', () => {
    const a = recipeKey({ kind: 'crop', box: { x: 0.12341, y: 0, width: 0.8, height: 1 } })
    const b = recipeKey({ kind: 'crop', box: { x: 0.12339, y: 0, width: 0.8, height: 1 } })
    expect(a).toBe(b)
  })

  test.each([
    ['', 'ig_feed'],
    ['crop-1-2-3', 'ig_feed'],
    ['crop-0-0-10000-10000', 'reel'],
    ['crop-5000-0-6000-10000', 'ig_feed'],
    ['pad-0', 'ig_feed'],
    ['reel-zoom', 'reel'],
    ['fb', 'ig_feed'],
    ['story-', 'story'],
    ['frame-10-left', 'cover'],
    ['cover-1-2', 'cover'],
    ['Crop-0-0-1-1', 'ig_feed'],
  ] as const)('%s is no recipe of %s', (key, purpose) => {
    expect(parseRecipe(purpose, key)).toBeNull()
  })
})

describe('the box at the centre', () => {
  test('a tall photo keeps its width', () => {
    const box = centerBox(1000, 2000, 4 / 5)
    expect(box.x).toBe(0)
    expect(box.width).toBe(1)
    expect(box.height).toBeCloseTo(0.625)
    expect(box.y).toBeCloseTo(0.1875)
  })

  test('a wide photo keeps its height', () => {
    const box = centerBox(1920, 1080, 9 / 16)
    expect(box.y).toBe(0)
    expect(box.height).toBe(1)
    expect(box.width * 1920).toBeCloseTo(607.5)
    expect(box.x + box.width / 2).toBeCloseTo(0.5)
  })
})

describe('a video fitted to 9:16', () => {
  test.each([
    ['16:9 with bands', 1920, 1080, 'pad', 1080, 1920],
    ['16:9 cut at the centre', 1920, 1080, 'crop', 606, 1080],
    ['small 16:9 with bands, not enlarged', 640, 360, 'pad', 640, 1136],
    ['square cut', 1080, 1080, 'crop', 606, 1080],
    ['4K vertical with bands', 2160, 3840, 'pad', 1080, 1920],
    ['tall 1:3 with bands', 600, 1800, 'pad', 1012, 1800],
    ['tall 1:3 cut', 600, 1800, 'crop', 600, 1066],
  ] as const)('%s', (_name, w, h, fit, width, height) => {
    expect(fittedSize(w, h, fit)).toEqual({ width, height })
  })
})

import { expect, test } from 'vitest'
import {
  centerBox,
  dragCorner,
  fromFractions,
  placeBox,
  toFractions,
  type CropSpec,
} from '../app/utils/crop-box.ts'

// The crop box (plan 06 Task 6, D-61): inside the photo, fixed proportions, the shortest side
// at least the minimum, the fractions a choice saves.

const landscape: CropSpec = { width: 4032, height: 3024, ratio: 4 / 5, minSide: 320 }
const portrait: CropSpec = { width: 1080, height: 1920, ratio: 4 / 5, minSide: 320 }
const ratioOf = (b: { width: number; height: number }) => b.width / b.height

test('the crop starts from the largest box in the middle', () => {
  const box = centerBox(landscape)
  expect(box.height).toBe(3024)
  expect(box.width).toBeCloseTo(2419.2)
  expect(box.x).toBeCloseTo((4032 - 2419.2) / 2)
  expect(box.y).toBe(0)
  const tall = centerBox(portrait)
  expect(tall.width).toBe(1080)
  expect(tall.height).toBe(1350)
  expect(tall.y).toBe(285)
})

test('the box never leaves the photo and keeps its proportions', () => {
  const start = centerBox(landscape)
  const right = placeBox(start, 99_999, -50, start.width, landscape)
  expect(right.x + right.width).toBeCloseTo(4032)
  expect(right.y).toBe(0)
  const smaller = placeBox(start, start.x, start.y, 1000, landscape)
  expect(ratioOf(smaller)).toBeCloseTo(0.8)
  expect(smaller.x + smaller.width / 2).toBeCloseTo(start.x + start.width / 2)
  const moved = placeBox(smaller, -10, 99_999, smaller.width, landscape)
  expect(moved.x).toBe(0)
  expect(moved.y + moved.height).toBeCloseTo(3024)
})

test('the shortest side does not go under the minimum, nor the box over the photo', () => {
  const start = centerBox(landscape)
  const tiny = placeBox(start, 0, 0, 10, landscape)
  expect(Math.min(tiny.width, tiny.height)).toBeCloseTo(320)
  const huge = placeBox(start, 0, 0, 99_999, landscape)
  expect(huge.height).toBeCloseTo(3024)
  // a 1.91:1 box: the height is the short side
  const wide: CropSpec = { width: 4000, height: 1000, ratio: 1.91, minSide: 320 }
  const narrow = placeBox(centerBox(wide), 0, 0, 1, wide)
  expect(narrow.height).toBeCloseTo(320)
  expect(ratioOf(narrow)).toBeCloseTo(1.91)
})

test('a corner drags the box from the opposite corner, within the photo', () => {
  const start = placeBox(centerBox(portrait), 100, 100, 500, portrait)
  const bigger = dragCorner(start, 'se', 900, 2000, portrait)
  expect(bigger.x).toBe(start.x)
  expect(bigger.y).toBe(start.y)
  expect(bigger.x + bigger.width).toBeLessThanOrEqual(1080 + 1e-9)
  expect(ratioOf(bigger)).toBeCloseTo(0.8)
  const fromTopLeft = dragCorner(start, 'nw', 0, 0, portrait)
  expect(fromTopLeft.x + fromTopLeft.width).toBeCloseTo(start.x + start.width)
  expect(fromTopLeft.y + fromTopLeft.height).toBeCloseTo(start.y + start.height)
  expect(fromTopLeft.x).toBeGreaterThanOrEqual(0)
})

test('the fractions of a 4032×3024 and a 1080×1920 photo, and back', () => {
  const f = toFractions(centerBox(landscape), landscape)
  expect(f.y).toBe(0)
  expect(f.height).toBe(1)
  expect(f.width).toBeCloseTo(0.6)
  expect(f.x).toBeCloseTo(0.2)
  expect((f.width * 4032) / (f.height * 3024)).toBeCloseTo(0.8)
  const g = toFractions(centerBox(portrait), portrait)
  expect(g).toEqual({ x: 0, y: 285 / 1920, width: 1, height: 1350 / 1920 })
  const back = fromFractions({ x: 0.1, y: 0, width: 0.6, height: 1 }, landscape)
  expect(back.x).toBeCloseTo(403.2)
  expect(back.width).toBeCloseTo(2419.2)
})

test('the profile photo: whole pixels, the square zoomed around its centre', () => {
  const square: CropSpec = { width: 600, height: 400, ratio: 1, minSide: 64, round: true }
  const start = centerBox(square)
  expect(start).toEqual({ x: 100, y: 0, width: 400, height: 400 })
  const zoomed = placeBox(start, start.x, start.y, 360, square)
  expect(zoomed).toEqual({ x: 120, y: 20, width: 360, height: 360 })
  expect(placeBox(zoomed, 102, 2, 360, square)).toEqual({ x: 102, y: 2, width: 360, height: 360 })
  // a photo smaller than the minimum: the whole short side
  const small: CropSpec = { width: 50, height: 40, ratio: 1, minSide: 64, round: true }
  expect(placeBox(centerBox(small), 0, 0, 1, small).width).toBe(40)
})

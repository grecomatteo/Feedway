import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  checkUploadFile,
  contentDigest,
  declaredTypeOf,
  formatEta,
  missingParts,
  partSlice,
  pastedFileName,
  rateMeter,
  sameFile,
  slowPieces,
  stallTimer,
} from '../app/utils/upload-file.ts'

const limits = { maxImageBytes: 50_000_000, maxVideoBytes: 300_000_000 }

describe('declaredTypeOf', () => {
  test('takes the browser type when Feedway knows it', () => {
    expect(declaredTypeOf({ name: 'a.jpg', type: 'image/jpeg' })).toBe('image/jpeg')
    expect(declaredTypeOf({ name: 'clip.mov', type: 'video/quicktime' })).toBe('video/quicktime')
  })
  test('reads the extension when the browser gives no type (a HEIC on Windows)', () => {
    expect(declaredTypeOf({ name: 'IMG_0001.HEIC', type: '' })).toBe('image/heic')
    expect(declaredTypeOf({ name: 'x.heif', type: 'application/octet-stream' })).toBe('image/heif')
    expect(declaredTypeOf({ name: 'v.MOV', type: '' })).toBe('video/quicktime')
    expect(declaredTypeOf({ name: 'p.jpeg', type: '' })).toBe('image/jpeg')
  })
  test('anything else is not a type Feedway takes', () => {
    expect(declaredTypeOf({ name: 'a.gif', type: 'image/gif' })).toBeNull()
    expect(declaredTypeOf({ name: 'notes.pdf', type: '' })).toBeNull()
    expect(declaredTypeOf({ name: 'noext', type: '' })).toBeNull()
  })
})

describe('checkUploadFile', () => {
  test('a photo and a video within the limits pass', () => {
    expect(checkUploadFile({ name: 'a.png', type: 'image/png', size: 1000 }, limits)).toEqual({
      ok: true,
      type: 'image/png',
      kind: 'image',
    })
    expect(
      checkUploadFile({ name: 'v.mp4', type: 'video/mp4', size: 300_000_000 }, limits),
    ).toEqual({ ok: true, type: 'video/mp4', kind: 'video' })
  })
  test('each kind has its own limit', () => {
    expect(
      checkUploadFile({ name: 'a.jpg', type: 'image/jpeg', size: 50_000_001 }, limits),
    ).toEqual({ ok: false, reason: 'size', kind: 'image', limit: 50_000_000 })
    expect(
      checkUploadFile({ name: 'v.mp4', type: 'video/mp4', size: 300_000_001 }, limits),
    ).toEqual({ ok: false, reason: 'size', kind: 'video', limit: 300_000_000 })
  })
  test('an empty file and an unknown type are refused', () => {
    expect(checkUploadFile({ name: 'a.jpg', type: 'image/jpeg', size: 0 }, limits)).toEqual({
      ok: false,
      reason: 'empty',
    })
    expect(checkUploadFile({ name: 'a.gif', type: 'image/gif', size: 10 }, limits)).toEqual({
      ok: false,
      reason: 'type',
    })
  })
})

test('pieces are cut as the server counts them, the last one shorter', () => {
  expect(partSlice(1, 50, 20)).toEqual({ start: 0, end: 20 })
  expect(partSlice(3, 50, 20)).toEqual({ start: 40, end: 50 })
  expect(missingParts(3, [2])).toEqual([1, 3])
  expect(missingParts(2, [1, 2])).toEqual([])
})

test('Content-Digest carries the sha-256 in base64, as RFC 9530 writes it', () => {
  // sha-256 of the empty string
  const hex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  const bytes = new Uint8Array(hex.match(/../g)?.map((h) => parseInt(h, 16)) ?? [])
  expect(contentDigest(bytes)).toBe('sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:')
})

test('the same file chosen again is known by name, size and first piece', () => {
  const upload = { name: 'a.mov', sizeBytes: 10, firstPartSha256: 'ab' }
  expect(sameFile(upload, { name: 'a.mov', size: 10 }, 'ab')).toBe(true)
  expect(sameFile(upload, { name: 'a.mov', size: 10 }, 'cd')).toBe(false)
  expect(sameFile(upload, { name: 'b.mov', size: 10 }, 'ab')).toBe(false)
})

test('a pasted picture gets a name with the date and its extension', () => {
  const at = new Date(2026, 10, 16, 9, 5, 7)
  expect(pastedFileName('image/png', at)).toBe('Incollata 2026-11-16 09.05.07.png')
  expect(pastedFileName('image/jpeg', at)).toBe('Incollata 2026-11-16 09.05.07.jpg')
})

test('the time left reads in seconds, minutes or hours', () => {
  expect(formatEta(4)).toBe('pochi secondi')
  expect(formatEta(42)).toBe('42 s')
  expect(formatEta(150)).toBe('3 min')
  expect(formatEta(3_900)).toBe('1 h 5 min')
})

test('the speed is the bytes of the last seconds, not since the start', () => {
  const meter = rateMeter(10_000)
  expect(meter.rate()).toBeNull()
  meter.add(0, 0)
  meter.add(1_000, 1_000)
  expect(meter.rate()).toBe(1_000)
  meter.add(2_000, 5_000)
  expect(meter.rate()).toBe(2_500)
  // a pause: the old samples fall out of the window
  meter.add(30_000, 5_000)
  meter.add(31_000, 6_000)
  expect(meter.rate()).toBe(1_000)
  meter.reset()
  expect(meter.rate()).toBeNull()
})

describe('stallTimer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  test('fires once when nothing moves for the whole wait', () => {
    vi.useFakeTimers()
    const stalled = vi.fn()
    stallTimer(45_000, stalled)
    vi.advanceTimersByTime(44_999)
    expect(stalled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(stalled).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(100_000)
    expect(stalled).toHaveBeenCalledTimes(1)
  })
  test('every sign of progress gives the whole wait again', () => {
    vi.useFakeTimers()
    const stalled = vi.fn()
    const timer = stallTimer(45_000, stalled)
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(40_000)
      timer.poke()
    }
    expect(stalled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(45_000)
    expect(stalled).toHaveBeenCalledTimes(1)
  })
  test('stopped, it never fires', () => {
    vi.useFakeTimers()
    const stalled = vi.fn()
    const timer = stallTimer(45_000, stalled)
    timer.stop()
    timer.poke()
    vi.advanceTimersByTime(100_000)
    expect(stalled).not.toHaveBeenCalled()
  })
})

describe('slowPieces', () => {
  test('the same piece falling twice after minutes of sending: the network is too slow', () => {
    const slow = slowPieces(240_000)
    expect(slow.failed(3, 250_000)).toBe(false)
    expect(slow.failed(3, 260_000)).toBe(true)
  })
  test('quick falls, another piece or a piece that arrived start the count again', () => {
    const slow = slowPieces(240_000)
    expect(slow.failed(3, 250_000)).toBe(false)
    // a fall of a few seconds is a network that comes and goes, not a slow one
    expect(slow.failed(3, 5_000)).toBe(false)
    expect(slow.failed(3, 250_000)).toBe(false)
    expect(slow.failed(4, 250_000)).toBe(false)
    slow.arrived()
    expect(slow.failed(4, 250_000)).toBe(false)
    expect(slow.failed(4, 250_000)).toBe(true)
  })
})

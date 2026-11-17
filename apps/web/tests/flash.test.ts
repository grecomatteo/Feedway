import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { effectScope } from 'vue'
import { FLASH_MS, useFlash } from '../app/composables/useFlash.ts'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('a message goes away by itself after a few seconds', () => {
  const done = useFlash()
  done.value = '«pane.jpg» eliminato.'
  vi.advanceTimersByTime(FLASH_MS - 1)
  expect(done.value).toBe('«pane.jpg» eliminato.')
  vi.advanceTimersByTime(1)
  expect(done.value).toBeNull()
})

test('a new message starts the time again', () => {
  const done = useFlash(1000)
  done.value = 'primo'
  vi.advanceTimersByTime(800)
  done.value = 'secondo'
  vi.advanceTimersByTime(800)
  expect(done.value).toBe('secondo')
  vi.advanceTimersByTime(200)
  expect(done.value).toBeNull()
})

test('clearing it stops the timer', () => {
  const done = useFlash(1000)
  done.value = 'primo'
  done.value = null
  expect(done.value).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})

test('the timer stops with the component', () => {
  const scope = effectScope()
  const done = scope.run(() => useFlash(1000))
  if (!done) throw new Error('scope not active')
  done.value = 'primo'
  scope.stop()
  expect(vi.getTimerCount()).toBe(0)
})

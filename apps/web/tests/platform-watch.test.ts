import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { everyMinute } from '../server/utils/every-minute.ts'

// The web's minute rounds (R4 of the tappa 8 review): the watch over the worker and the call to
// healthchecks.io, each on its own, so a slow or failing one never holds back the other.

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function logger() {
  const errors: unknown[] = []
  return { errors, error: (fields: unknown) => errors.push(fields) }
}

test('every tick runs each task, and nothing before the first minute', async () => {
  const runs: string[] = []
  const stop = everyMinute(
    [
      { name: 'a', run: () => Promise.resolve(runs.push('a')) },
      { name: 'b', run: () => Promise.resolve(runs.push('b')) },
    ],
    logger(),
    1000,
  )
  await vi.advanceTimersByTimeAsync(999)
  expect(runs).toEqual([])
  await vi.advanceTimersByTimeAsync(2001)
  expect(runs).toEqual(['a', 'b', 'a', 'b', 'a', 'b'])
  stop()
  await vi.advanceTimersByTimeAsync(5000)
  expect(runs).toHaveLength(6)
})

test('a task still running skips its own tick, never the other', async () => {
  let release: () => void = () => undefined
  let slow = 0
  let fast = 0
  const stop = everyMinute(
    [
      {
        name: 'slow',
        run: () => {
          slow += 1
          return new Promise<void>((resolve) => {
            release = resolve
          })
        },
      },
      { name: 'fast', run: () => Promise.resolve((fast += 1)) },
    ],
    logger(),
    1000,
  )
  await vi.advanceTimersByTimeAsync(3000)
  expect({ slow, fast }).toEqual({ slow: 1, fast: 3 })
  release()
  await vi.advanceTimersByTimeAsync(1000)
  expect({ slow, fast }).toEqual({ slow: 2, fast: 4 })
  stop()
})

test('a failure is logged with its task, and the next tick tries again', async () => {
  const log = logger()
  let calls = 0
  const stop = everyMinute(
    [
      {
        name: 'external-watch',
        run: () => {
          calls += 1
          return Promise.reject(new Error('down'))
        },
      },
    ],
    log,
    1000,
  )
  await vi.advanceTimersByTimeAsync(2000)
  expect(calls).toBe(2)
  expect(log.errors).toHaveLength(2)
  expect(log.errors[0]).toMatchObject({ task: 'external-watch' })
  stop()
})

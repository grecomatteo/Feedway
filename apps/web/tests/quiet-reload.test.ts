import { expect, test } from 'vitest'
import { quietReload } from '../app/utils/quiet-reload.ts'

// `/api/v1/me` read again in the background no more than once every 30 s, never twice at once
// (D-120.7: with a slow network the panel asked it every 2 s).
test('one read at a time, then none for 30 seconds', async () => {
  let clock = 0
  let calls = 0
  let finish: () => void = () => undefined
  const reload = quietReload(
    () => {
      calls++
      return new Promise<void>((r) => (finish = r))
    },
    30_000,
    () => clock,
  )
  const first = reload()
  void reload()
  expect(calls).toBe(1)
  clock = 5_000
  finish()
  await first
  void reload()
  expect(calls).toBe(1)
  clock = 30_001
  void reload()
  expect(calls).toBe(2)
})

test('a failed read lets the next one go after the gap', async () => {
  let clock = 0
  let calls = 0
  const reload = quietReload(
    () => {
      calls++
      return Promise.reject(new Error('rete'))
    },
    30_000,
    () => clock,
  )
  await reload()
  clock = 31_000
  await reload()
  expect(calls).toBe(2)
})

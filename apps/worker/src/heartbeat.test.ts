import { mkdtempSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { runHealthcheck } from './healthcheck.js'
import { startHeartbeat } from './heartbeat.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const stops: (() => void)[] = []
afterEach(() => {
  for (const stop of stops.splice(0)) stop()
})

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'hb-')), 'heartbeat')

test('heartbeat file is written at once and refreshed', async () => {
  const path = tmpFile()
  stops.push(startHeartbeat(path, 100))
  const t1 = statSync(path).mtimeMs
  await sleep(250)
  expect(statSync(path).mtimeMs).toBeGreaterThan(t1)
})

test('healthcheck passes with a fresh heartbeat', () => {
  const path = tmpFile()
  writeFileSync(path, new Date().toISOString())
  expect(runHealthcheck(path)).toBe(0)
})

test('healthcheck fails when heartbeat is stale', () => {
  const path = tmpFile()
  writeFileSync(path, 'x')
  const old = new Date(Date.now() - 120_000)
  utimesSync(path, old, old)
  expect(runHealthcheck(path)).toBe(1)
})

test('healthcheck fails when the heartbeat file is missing', () => {
  expect(runHealthcheck(join(tmpdir(), 'does-not-exist-heartbeat'))).toBe(1)
})

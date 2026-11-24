import { mkdtempSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { runHealthcheck } from './healthcheck.js'
import type { Logger } from '@app/application'
import { startDatabaseBeat, startHeartbeat } from './heartbeat.js'

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

function recordingLogger(): Logger & { warned: string[] } {
  const warned: string[] = []
  const logger: Logger & { warned: string[] } = {
    warned,
    debug: () => undefined,
    info: () => undefined,
    warn: (_obj, msg) => warned.push(msg ?? ''),
    error: () => undefined,
    child: () => logger,
  }
  return logger
}

test('the database beat is written at once and again, and a failure only goes to the log', async () => {
  let calls = 0
  const logger = recordingLogger()
  stops.push(
    startDatabaseBeat(
      () => {
        calls += 1
        return calls === 1 ? Promise.reject(new Error('database down')) : Promise.resolve()
      },
      100,
      logger,
    ),
  )
  expect(calls).toBe(1)
  await sleep(250)
  expect(calls).toBeGreaterThanOrEqual(2)
  expect(logger.warned).toEqual(['worker beat not written'])
})

test('a slow database never piles the beats up', async () => {
  let calls = 0
  stops.push(
    startDatabaseBeat(
      () => {
        calls += 1
        return sleep(400).then(() => undefined)
      },
      100,
      recordingLogger(),
    ),
  )
  await sleep(250)
  expect(calls).toBe(1)
})

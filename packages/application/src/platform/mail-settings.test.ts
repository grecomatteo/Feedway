import { describe, expect, test, vi } from 'vitest'
import type { IntegrationStore } from '../ports/integration-store.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { createMailSettings, type MailSettingsMemory } from './mail-settings.js'

// R1 of the tappa 8 review: `isConfigured` is asked inside the dispatcher's transaction for
// every recipient. With a memory, after the first read it opens no transaction of its own.

function world(opts: { set: boolean; memory?: Partial<MailSettingsMemory> | false }) {
  let set = opts.set
  let now = new Date('2026-11-24T10:00:00Z')
  const runAsSystem = vi.fn(
    (...args: [reason: string, fn: (tx: unknown) => Promise<unknown>, opts?: unknown]) =>
      args[1]({}),
  )
  const uow = { run: vi.fn(), runAsSystem } as unknown as UnitOfWork
  const integrations = {
    getPlatform: () => Promise.resolve(set ? { config: {} } : null),
    platformCredentials: () => Promise.resolve(null),
  } as unknown as IntegrationStore
  const clock = { now: () => now }
  const settings = createMailSettings(
    { uow, integrations },
    opts.memory === false ? undefined : { clock, setMs: 30_000, unsetMs: 30_000, ...opts.memory },
  )
  return {
    settings,
    runAsSystem,
    setSmtp: (value: boolean) => {
      set = value
    },
    later: (ms: number) => {
      now = new Date(now.getTime() + ms)
    },
  }
}

describe('createMailSettings', () => {
  test('without a memory every question is a transaction, as before', async () => {
    const w = world({ set: true, memory: false })
    expect(await w.settings.isConfigured()).toBe(true)
    expect(await w.settings.isConfigured()).toBe(true)
    expect(w.runAsSystem).toHaveBeenCalledTimes(2)
  })

  test('a «set» is read once: a hundred recipients open no other transaction', async () => {
    const w = world({ set: true })
    for (let i = 0; i < 100; i += 1) expect(await w.settings.isConfigured()).toBe(true)
    expect(w.runAsSystem).toHaveBeenCalledTimes(1)
  })

  test('questions asked together share one read', async () => {
    const w = world({ set: true })
    const answers = await Promise.all([1, 2, 3].map(() => w.settings.isConfigured()))
    expect(answers).toEqual([true, true, true])
    expect(w.runAsSystem).toHaveBeenCalledTimes(1)
  })

  test('an old «set» is answered at once and read again in the background', async () => {
    const w = world({ set: true })
    await w.settings.isConfigured()
    w.later(30_000)
    expect(await w.settings.isConfigured()).toBe(true)
    expect(w.runAsSystem).toHaveBeenCalledTimes(2)
  })

  test('the worker keeps an «unset» for its time, then reads again', async () => {
    const w = world({ set: false })
    expect(await w.settings.isConfigured()).toBe(false)
    w.setSmtp(true)
    expect(await w.settings.isConfigured()).toBe(false)
    expect(w.runAsSystem).toHaveBeenCalledTimes(1)
    w.later(30_000)
    expect(await w.settings.isConfigured()).toBe(true)
  })

  test('the web never keeps an «unset»: the SMTP just saved counts at once', async () => {
    const w = world({ set: false, memory: { unsetMs: 0 } })
    expect(await w.settings.isConfigured()).toBe(false)
    w.setSmtp(true)
    expect(await w.settings.isConfigured()).toBe(true)
  })

  test('a read that fails is not remembered', async () => {
    const w = world({ set: true })
    w.runAsSystem.mockImplementationOnce(() => Promise.reject(new Error('pool')))
    await expect(w.settings.isConfigured()).rejects.toThrow('pool')
    expect(await w.settings.isConfigured()).toBe(true)
  })

  test('its transactions are routine: logged at debug', async () => {
    const w = world({ set: true })
    await w.settings.isConfigured()
    await w.settings.credentials()
    for (const call of w.runAsSystem.mock.calls) expect(call[2]).toEqual({ routine: true })
  })
})

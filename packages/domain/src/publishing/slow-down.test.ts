import { describe, expect, test } from 'vitest'
import { slowDownUntil, type UsageReading } from './slow-down.js'

const now = new Date('2026-11-20T17:45:00Z')
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000)
const plus = (minutes: number, from = now) => new Date(from.getTime() + minutes * 60_000)

const reading = (fields: Partial<UsageReading>): UsageReading => ({
  accountPercent: null,
  appPercent: null,
  regainMinutes: 0,
  readAt: now,
  ...fields,
})

describe('slowDownUntil (§8.6)', () => {
  test('at or below 80% nothing waits', () => {
    const r = reading({ accountPercent: 80, appPercent: 80 })
    expect(slowDownUntil('prepare', { account: r, agency: r }, now)).toBeNull()
    expect(slowDownUntil('prepare', { account: null, agency: null }, now)).toBeNull()
  })

  test("above 80% an account's preparation waits what Meta says, at most 5 minutes", () => {
    const at = (regainMinutes: number) =>
      slowDownUntil(
        'prepare',
        { account: reading({ accountPercent: 85, regainMinutes }), agency: null },
        now,
      )
    expect(at(3)).toEqual(plus(3))
    expect(at(30)).toEqual(plus(5))
    // Meta said nothing: one minute, then the next answer tells
    expect(at(0)).toEqual(plus(1))
  })

  test('the wait counts from the reading: once over, the step runs', () => {
    const old = reading({ accountPercent: 90, regainMinutes: 2, readAt: ago(90) })
    expect(slowDownUntil('prepare', { account: old, agency: null }, now)).toEqual(plus(2, ago(90)))
    const over = reading({ accountPercent: 90, regainMinutes: 2, readAt: ago(120) })
    expect(slowDownUntil('prepare', { account: over, agency: null }, now)).toBeNull()
  })

  test("the app's usage of another account of the agency moves this one too", () => {
    const other = reading({ appPercent: 88, readAt: ago(10) })
    expect(slowDownUntil('prepare', { account: null, agency: other }, now)).toEqual(
      plus(1, ago(10)),
    )
  })

  test('publish waits only above 95%, so 85% never makes a post late', () => {
    const at85 = reading({ accountPercent: 85, appPercent: 85, regainMinutes: 4 })
    expect(slowDownUntil('publish', { account: at85, agency: at85 }, now)).toBeNull()
    const at96 = reading({ accountPercent: 96, regainMinutes: 4 })
    expect(slowDownUntil('publish', { account: at96, agency: null }, now)).toEqual(plus(4))
  })

  test('the latest of the waits wins', () => {
    const account = reading({ accountPercent: 90, regainMinutes: 3 })
    const agency = reading({ appPercent: 90 })
    expect(slowDownUntil('prepare', { account, agency }, now)).toEqual(plus(3))
  })
})

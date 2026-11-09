import { expect, test } from 'vitest'
import { isMetaUsageHigh, metaUsagePeak, type MetaUsage } from './usage.js'

const quiet = { callCount: 10, totalCputime: 5, totalTime: 7 }

const usage = (overrides: Partial<MetaUsage> = {}): MetaUsage => ({
  app: quiet,
  business: [
    { businessId: 'b1', type: 'instagram', ...quiet, estimatedTimeToRegainAccessMinutes: 0 },
  ],
  ...overrides,
})

test('the peak is the highest percentage of any counter, app or business', () => {
  expect(metaUsagePeak(usage())).toBe(10)
  expect(
    metaUsagePeak(
      usage({
        business: [
          { businessId: 'b1', type: 'pages', ...quiet, estimatedTimeToRegainAccessMinutes: 0 },
          {
            businessId: 'b2',
            type: 'instagram',
            ...quiet,
            totalTime: 64,
            estimatedTimeToRegainAccessMinutes: 0,
          },
        ],
      }),
    ),
  ).toBe(64)
  expect(metaUsagePeak({ app: null, business: [] })).toBe(0)
})

test('usage is high only above 80%', () => {
  expect(isMetaUsageHigh(usage({ app: { ...quiet, totalCputime: 80 } }))).toBe(false)
  expect(isMetaUsageHigh(usage({ app: { ...quiet, totalCputime: 81 } }))).toBe(true)
  expect(
    isMetaUsageHigh(
      usage({
        business: [
          {
            businessId: 'b1',
            type: 'instagram',
            ...quiet,
            callCount: 95,
            estimatedTimeToRegainAccessMinutes: 0,
          },
        ],
      }),
    ),
  ).toBe(true)
})

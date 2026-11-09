/** One counter set of Meta's usage headers, in percent of the allowed amount (spec §8.6). */
export interface MetaUsageCounters {
  callCount: number
  totalCputime: number
  totalTime: number
}

/** One entry of `X-Business-Use-Case-Usage`. */
export interface MetaBusinessUsage extends MetaUsageCounters {
  businessId: string
  type: string
  estimatedTimeToRegainAccessMinutes: number
}

/** `X-App-Usage` (null when absent) and `X-Business-Use-Case-Usage` of one answer. */
export interface MetaUsage {
  app: MetaUsageCounters | null
  business: MetaBusinessUsage[]
}

/** Above this percentage the worker slows down by itself (spec §8.6; applied from stage 7). */
export const META_USAGE_THRESHOLD_PERCENT = 80

const peakOf = (c: MetaUsageCounters) => Math.max(c.callCount, c.totalCputime, c.totalTime)

export function metaUsagePeak(usage: MetaUsage): number {
  return Math.max(0, ...(usage.app ? [peakOf(usage.app)] : []), ...usage.business.map(peakOf))
}

export function isMetaUsageHigh(usage: MetaUsage): boolean {
  return metaUsagePeak(usage) > META_USAGE_THRESHOLD_PERCENT
}

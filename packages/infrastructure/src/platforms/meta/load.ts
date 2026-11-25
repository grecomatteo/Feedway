import type { PlatformLoad } from '@app/application'
import type { MetaUsage } from '@app/domain/platforms/meta'

const peak = (c: { callCount: number; totalCputime: number; totalTime: number }) =>
  Math.max(c.callCount, c.totalCputime, c.totalTime)

/** How close the limits are, from the usage headers of one answer (§8.6). */
export function loadOf(usage: MetaUsage): PlatformLoad {
  return {
    accountPercent: usage.business.length === 0 ? null : Math.max(...usage.business.map(peak)),
    appPercent: usage.app === null ? null : peak(usage.app),
    regainMinutes: Math.max(0, ...usage.business.map((b) => b.estimatedTimeToRegainAccessMinutes)),
  }
}

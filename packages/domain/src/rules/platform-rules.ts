import { PLATFORMS, type Platform } from '../accounts/accounts.js'
import type { FileLimits } from '../media/check-file.js'
import type { PlatformRules } from './types.js'

// The rules of the platforms, gathered in the composition root (ADR 019, R2).

export function platformRulesMap(
  rules: readonly PlatformRules[],
): ReadonlyMap<Platform, PlatformRules> {
  return new Map(rules.map((r) => [r.platform, r]))
}

/** The photo limits `checkFile` gets: every platform Feedway knows must have its rules. */
export function photoMaxBytesOf(
  platforms: ReadonlyMap<Platform, PlatformRules>,
): FileLimits['photoMaxBytes'] {
  const limits = {} as Record<Platform, number>
  for (const platform of PLATFORMS) {
    const rules = platforms.get(platform)
    if (!rules) throw new Error(`no rules for the platform ${platform}`)
    limits[platform] = rules.photoMaxBytes
  }
  return limits
}

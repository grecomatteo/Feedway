import { CHANNELS, type Channel } from './channels.js'
import { DEFAULT_DIGEST, type DigestSchedule } from './digest-schedule.js'
import type { NotificationKindRule } from './kinds.js'
import { atLeast, type Level } from './levels.js'
import { inQuietHours, type QuietHours } from './quiet-hours.js'
import type { Recipient } from './recipients.js'

/** A person's choice for one kind, kept only where they changed something (P4). */
export interface NotificationPref {
  /** none: the kind is off for them */
  channels: readonly Channel[]
}

/** A person's settings for every kind (`notification_settings`, P4). */
export interface NotificationSettings {
  /** Below it, only the panel (§12.3 «livello minimo») */
  minLevel: Level
  /** Off by default (Scelta 6) */
  quietHours: QuietHours | null
  digest: DigestSchedule
  /** «Tutto ovunque», for tests (§12.3) */
  everythingEverywhere: boolean
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  minLevel: 'info',
  quietHours: null,
  digest: DEFAULT_DIGEST,
  everythingEverywhere: false,
}

export interface ChannelsInput {
  kind: NotificationKindRule
  recipient: Recipient
  pref: NotificationPref | null
  settings: NotificationSettings
  now: Date
  /** The person's zone, for the quiet hours */
  timeZone: string
}

const OUTSIDE: readonly Channel[] = ['telegram', 'email']

/**
 * Where one person gets one notification (§12.3, Scelta 6, D-74); empty when they turned the
 * kind off. In quiet hours what is below an error stays in the panel and is not sent later.
 */
export function channelsFor({
  kind,
  recipient,
  pref,
  settings,
  now,
  timeZone,
}: ChannelsInput): Channel[] {
  const chosen = new Set<Channel>(
    settings.everythingEverywhere ? CHANNELS : (pref?.channels ?? kind.defaultChannels),
  )
  const outsideOff =
    (!settings.everythingEverywhere && !atLeast(kind.level, settings.minLevel)) ||
    (!atLeast(kind.level, 'error') && inQuietHours(settings.quietHours, now, timeZone))
  if (outsideOff) for (const channel of OUTSIDE) chosen.delete(channel)
  if (kind.alwaysEmail && recipient.as.includes(kind.alwaysEmail)) chosen.add('email')
  return CHANNELS.filter((c) => chosen.has(c))
}

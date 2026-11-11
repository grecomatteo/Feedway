import type { ConnectionStatus } from './accounts.js'

/** The Graph API version is recalled from 90 days before Meta retires it (§8.4). */
export const GRAPH_SUNSET_NOTICE_DAYS = 90
/** The yearly Data Use Checkup is recalled from 30 days before the date the Owner typed. */
export const DATA_USE_CHECKUP_NOTICE_DAYS = 30
/**
 * A token is recalled from 5 days before it expires: renewal starts at 7 days, so a token still
 * this close after two daily runs is one that does not renew.
 */
export const TOKEN_EXPIRY_NOTICE_MS = 5 * 24 * 60 * 60 * 1000

/** What Owner and Admin are reminded of about Meta (§8.4, RF-21); the panel words it. */
export type MetaReminder =
  /** `daysLeft` below zero: already retired. */
  | { kind: 'graph_version_sunset'; version: string; dueOn: string; daysLeft: number }
  /** `daysLeft` below zero: overdue. */
  | { kind: 'data_use_checkup'; dueOn: string; daysLeft: number }
  /** The client took the access back: the connection needs a new access. */
  | { kind: 'access_revoked'; connectionId: string }
  /** A token that still works and ends soon without having been renewed. */
  | { kind: 'token_expiring'; connectionId: string; expiresAt: Date }

export interface MetaRemindersInput {
  /** The calendar date (YYYY-MM-DD) in the panel's time zone. */
  today: string
  now: Date
  graphVersion: string
  /** YYYY-MM-DD */
  graphVersionSunset: string
  /** YYYY-MM-DD, or null while the app is in development. */
  dataUseCheckupDueOn: string | null
  connections: readonly { id: string; status: ConnectionStatus; expiresAt: Date | null }[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const utcDay = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d)
}

/** Calendar days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysUntil(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS)
}

export function metaReminders(input: MetaRemindersInput): MetaReminder[] {
  const reminders: MetaReminder[] = []
  const sunsetIn = daysUntil(input.today, input.graphVersionSunset)
  if (sunsetIn <= GRAPH_SUNSET_NOTICE_DAYS)
    reminders.push({
      kind: 'graph_version_sunset',
      version: input.graphVersion,
      dueOn: input.graphVersionSunset,
      daysLeft: sunsetIn,
    })
  const dueOn = input.dataUseCheckupDueOn
  if (dueOn !== null) {
    const dueIn = daysUntil(input.today, dueOn)
    if (dueIn <= DATA_USE_CHECKUP_NOTICE_DAYS)
      reminders.push({ kind: 'data_use_checkup', dueOn, daysLeft: dueIn })
  }
  for (const c of input.connections)
    if (c.status === 'revoked') reminders.push({ kind: 'access_revoked', connectionId: c.id })
  for (const c of input.connections) {
    const works = c.status === 'active' || c.status === 'pending'
    if (
      works &&
      c.expiresAt !== null &&
      c.expiresAt.getTime() - input.now.getTime() <= TOKEN_EXPIRY_NOTICE_MS
    )
      reminders.push({ kind: 'token_expiring', connectionId: c.id, expiresAt: c.expiresAt })
  }
  return reminders
}

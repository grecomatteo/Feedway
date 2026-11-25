import type { NotificationItem, NotificationKindName } from '@app/contracts'
import { formatRelative, formatTime } from './format-date.ts'

// The notification centre's small rules (plan 08 Task 6), apart from the components so they are
// tested on their own. The icons are named in full: the icon bundle finds them by scanning.

const ICONS: Record<NotificationKindName, string> = {
  'post.target_confirmed': 'i-lucide-circle-check',
  'post.confirmed': 'i-lucide-circle-check',
  'post.target_failed': 'i-lucide-circle-x',
  'post.target_problem': 'i-lucide-circle-alert',
  'post.paused': 'i-lucide-circle-pause',
  'post.file_wont_publish': 'i-lucide-file-x',
  'account.quota_low': 'i-lucide-gauge',
  'account.token_invalid': 'i-lucide-unplug',
  'account.unhealthy': 'i-lucide-plug-zap',
  'meta.reminder': 'i-lucide-calendar-clock',
  'system.worker_down': 'i-lucide-server-off',
  'system.worker_up': 'i-lucide-server',
  'system.backup_failed': 'i-lucide-database-backup',
  'plan.due_soon': 'i-lucide-calendar-check',
  'bulk.completed': 'i-lucide-calendar-plus',
}

export const notificationIcon = (kind: NotificationKindName) => ICONS[kind]

/** The key of a kind in it.json: `post.target_failed` → `post_target_failed`. */
export const kindKey = (kind: NotificationKindName) => kind.replace('.', '_')

/** The group of a kind in the preferences: by the module that writes it. */
export function kindGroup(kind: NotificationKindName): 'post' | 'plan' | 'account' | 'system' {
  if (kind.startsWith('post.') || kind.startsWith('bulk.')) return 'post'
  if (kind.startsWith('plan.')) return 'plan'
  if (kind.startsWith('system.')) return 'system'
  return 'account'
}

/** «9:31» today, then «ieri», «lun 16 nov», «3 nov» (screen 05). */
export function notificationTime(
  at: string,
  options: { timeZone?: string | null; now?: Date } = {},
): string {
  const day = formatRelative(at, { ...options, time: false })
  return day === 'oggi' ? formatTime(at, options) : day
}

/**
 * What happened outside the panel, one phrase per channel: «Email mandata», «Telegram non
 * collegato». The panel's delivery is the row itself and is not said.
 */
export function deliveryLines(
  item: Pick<NotificationItem, 'deliveries'>,
  t: (key: string) => string,
): string[] {
  return item.deliveries.flatMap((d) => {
    if (d.channel === 'panel') return []
    if (d.status === 'skipped') return d.error ? [d.error] : []
    const said = t(`notifications.delivery.${d.channel}.${d.status}`)
    return [d.status === 'failed' && d.error ? `${said}: ${d.error}` : said]
  })
}

// «Eliminati» (plan 09 Scelta 12, D-124): a draft or a cancelled post deleted from the panel
// waits there 30 days before it goes for good; a draft nobody touches goes there by itself after
// the days its client chose (30, 60, 90 or «Mai»); an empty draft goes for good after 24 hours.

const DAY_MS = 86_400_000

/** The choices of «Sposta negli Eliminati le bozze non toccate da»; null is «Mai». */
export const DRAFT_RETENTION_CHOICES = [30, 60, 90] as const
export type DraftRetentionDays = (typeof DRAFT_RETENTION_CHOICES)[number] | null
/** As spec §11.9: 30 days. */
export const DRAFT_RETENTION_DEFAULT = 30

/** How long a post stays in «Eliminati», the same for every client. */
export const TRASH_KEEP_DAYS = 30
/** An empty draft nobody touched for this long goes for good. */
export const EMPTY_DRAFT_KEEP_MS = DAY_MS
/** The list says «Va negli Eliminati tra N giorni» from this many days before. */
export const AUTO_TRASH_NOTICE_DAYS = 7
/** At most this many posts in one «Elimina», «Ripristina» or «Elimina per sempre». */
export const TRASH_BATCH_MAX = 100

export function isDraftRetention(value: unknown): value is DraftRetentionDays {
  return value === null || DRAFT_RETENTION_CHOICES.some((days) => days === value)
}

/** When a draft changed last at `updatedAt` goes to «Eliminati» by itself; null: never. */
export function autoTrashAt(updatedAt: Date, retentionDays: number | null): Date | null {
  return retentionDays === null ? null : new Date(updatedAt.getTime() + retentionDays * DAY_MS)
}

/** When a post in «Eliminati» since `trashedAt` goes for good. */
export const trashPurgeAt = (trashedAt: Date) =>
  new Date(trashedAt.getTime() + TRASH_KEEP_DAYS * DAY_MS)

/** Whether the list warns of it: within 7 days, or already due and waiting for the night. */
export const showsAutoTrash = (at: Date | null, now: Date) =>
  at !== null && at.getTime() - now.getTime() <= AUTO_TRASH_NOTICE_DAYS * DAY_MS

/** Whole days left, rounded up: «tra 5 giorni»; 0 when due. */
export const daysUntilAutoTrash = (at: Date, now: Date) =>
  Math.max(0, Math.ceil((at.getTime() - now.getTime()) / DAY_MS))

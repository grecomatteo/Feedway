/** Similar notifications within this time of the first become one message (§12.3, Scelta 7). */
export const GROUP_WINDOW_MS = 60_000
/** A grouped message lists this many and counts the others. */
export const GROUP_LIST_MAX = 10

/** When the group of a first notification is sent (the delivery's `startAfter`, P1). */
export function groupWindow(firstAt: Date): Date {
  return new Date(firstAt.getTime() + GROUP_WINDOW_MS)
}

export function inGroupWindow(firstAt: Date, at: Date): boolean {
  return at.getTime() <= groupWindow(firstAt).getTime()
}

export function groupListing<T>(items: readonly T[]): { shown: T[]; more: number } {
  return {
    shown: items.slice(0, GROUP_LIST_MAX),
    more: Math.max(0, items.length - GROUP_LIST_MAX),
  }
}

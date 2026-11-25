import { instantToZoned, zonedToInstant } from '@app/domain'
import type { CalendarPost } from '@app/contracts'

// Moving a post in the calendar (spec §11.4, plan 09 P7, Task 4): who may and what is sent. The
// server says the last word (`updatePost` with the version and the checks of «Programma»); these
// only keep the page from offering a move it would refuse.

const PUBLISHERS: readonly string[] = ['owner', 'admin', 'manager', 'publisher']
const MANAGERS: readonly string[] = ['owner', 'admin', 'manager']

/**
 * A draft with a day, or a scheduled post, that this person may change in the editor: its own
 * (or anyone's for who manages the posts of others), scheduling it for a scheduled one. Not a
 * post on its way, out or partly out (R6 of stage 7), nor one of an archived client; a post on
 * its way still in the panel's reach is changed from the editor, the calendar does not know it.
 */
export function mayMove(
  post: Pick<CalendarPost, 'status' | 'createdBy' | 'localDate' | 'localTime'>,
  client: { myRole: string; archivedAt: string | null } | undefined,
  meId: string | null,
): boolean {
  if (!client || client.archivedAt || client.myRole === 'viewer') return false
  if (post.localDate === null || post.localTime === null) return false
  if (post.createdBy !== meId && !MANAGERS.includes(client.myRole)) return false
  if (post.status === 'draft') return true
  return post.status === 'scheduled' && PUBLISHERS.includes(client.myRole)
}

/**
 * The `when` a move sends: the calendar's day and time are the agency's (D-58), the post keeps
 * its own zone, so the same instant is said in the post's.
 */
export function movedWhen(
  post: Pick<CalendarPost, 'timezone'>,
  to: { localDate: string; localTime: string },
  agencyTimeZone: string,
): { localDate: string; localTime: string } {
  if (post.timezone === agencyTimeZone) return { ...to }
  const { instant } = zonedToInstant(to.localDate, to.localTime, agencyTimeZone)
  const { localDate, localTime } = instantToZoned(instant, post.timezone)
  return { localDate, localTime }
}

import type { TimeSlot } from '@app/domain'
import type { PostScope } from './posts.js'

// The usual times of a workspace (spec §11.6, plan 09 Task 9). Every method takes the agency and
// the workspace and filters by them in SQL as well: row level security is the second barrier.

export interface TimeSlotsRepository {
  /** In order of the week and the time. */
  list(scope: PostScope): Promise<TimeSlot[]>
  /**
   * The slots become these, one replace at a time for the workspace (two «Salva» together
   * leave one of the two lists, never a mix or a duplicate). False: nothing changed.
   */
  replace(scope: PostScope, slots: readonly (TimeSlot & { id: string })[]): Promise<boolean>
  /** The instants of the workspace's scheduled posts in `[from, to)`: the slots they take. */
  scheduledAt(scope: PostScope, from: Date, to: Date): Promise<Date[]>
}

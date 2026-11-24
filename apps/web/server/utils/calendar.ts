import type { CalendarFilters } from '@app/domain'

type FilterQuery = {
  [K in Exclude<keyof CalendarFilters, 'quick' | 'show'>]?: CalendarFilters[K] | undefined
} & {
  quick?: CalendarFilters['quick'] | undefined
  show?: CalendarFilters['show'] | undefined
}

/** The filters of a calendar query, only those sent (`exactOptionalPropertyTypes`). */
export function calendarFiltersOf(query: FilterQuery): Partial<CalendarFilters> {
  const out: Partial<CalendarFilters> = {}
  for (const key of Object.keys(query) as (keyof FilterQuery)[]) {
    const value = query[key]
    if (value !== undefined) Object.assign(out, { [key]: value })
  }
  return out
}

import { getCalendar } from '@app/application'
import { calendarRoute } from '@app/contracts'

export default defineApiRoute(calendarRoute, ({ actor, query }) => {
  const { from, to, workspaceId, ...filters } = query
  return getCalendar(useDeps(), actor, {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    filters: calendarFiltersOf(filters),
  })
})

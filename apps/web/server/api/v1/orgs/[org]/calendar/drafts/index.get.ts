import { getUndatedDrafts } from '@app/application'
import { calendarDraftsRoute } from '@app/contracts'

export default defineApiRoute(calendarDraftsRoute, ({ actor, query }) => {
  const { workspaceId, ...filters } = query
  return getUndatedDrafts(useDeps(), actor, {
    ...(workspaceId === undefined ? {} : { workspaceId }),
    filters: calendarFiltersOf(filters),
  })
})

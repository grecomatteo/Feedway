import { getUndatedDrafts } from '@app/application'
import { calendarDraftsRoute } from '@app/contracts'

export default defineApiRoute(calendarDraftsRoute, ({ actor, query }) => {
  const { workspaceId, trashed, ...filters } = query
  return getUndatedDrafts(useDeps(), actor, {
    ...(workspaceId === undefined ? {} : { workspaceId }),
    filters: calendarFiltersOf(filters),
    // «Eliminati» of the list (plan 09 Scelta 12)
    trashed: trashed === '1',
  })
})

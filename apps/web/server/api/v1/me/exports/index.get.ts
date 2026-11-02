import { listDataExports } from '@app/application'
import { listDataExportsRoute } from '@app/contracts'

export default defineApiRoute(listDataExportsRoute, async ({ session }) => {
  const { uow, clock } = useDeps()
  return { items: await listDataExports({ uow, clock }, session.user) }
})

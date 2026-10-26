import { listMyOrganizations } from '@app/application'
import { myOrganizationsRoute } from '@app/contracts'

export default defineApiRoute(myOrganizationsRoute, async ({ session }) => ({
  items: await listMyOrganizations(useDeps(), { userId: session.user.id }),
}))

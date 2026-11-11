import { listAccounts } from '@app/application'
import { listAccountsRoute } from '@app/contracts'

export default defineApiRoute(listAccountsRoute, async ({ actor, query }) => {
  const page = await listAccounts(useDeps(), actor, query)
  return { items: page.items.map(accountListItemDto), nextCursor: page.nextCursor }
})

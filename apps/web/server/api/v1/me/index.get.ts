import { meRoute } from '@app/contracts'

// Also while the second factor is owed (only before any factor exists: 30.enforce-second-factor).
export default defineApiRoute(meRoute, ({ session }) => ({
  ...session.user,
  sessionState: session.state,
}))

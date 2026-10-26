import { secondFactorOverview } from '@app/application'
import { mySecondFactorRoute } from '@app/contracts'

export default defineApiRoute(mySecondFactorRoute, async ({ session }) => {
  const overview = await secondFactorOverview(useDeps(), session.user)
  return {
    ...overview,
    passkeys: overview.passkeys.map((p) => ({
      ...p,
      createdAt: p.createdAt?.toISOString() ?? null,
    })),
  }
})

import { testExternalWatch } from '@app/application'
import { testExternalWatchRoute } from '@app/contracts'

export default defineApiRoute(
  testExternalWatchRoute,
  async ({ actor, ip }) => {
    const report = await testExternalWatch(monitoringDeps(useDeps()), actor, { ip })
    return report.outcome === 'called'
      ? { configured: true, last: lastOutcomeDto(report.state) }
      : { configured: false, last: null }
  },
  { rateLimit: EXTERNAL_WATCH_RATE_LIMIT },
)

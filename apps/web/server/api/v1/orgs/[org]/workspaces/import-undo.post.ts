import { undoClientImport } from '@app/application'
import { undoClientImportRoute } from '@app/contracts'

export default defineApiRoute(undoClientImportRoute, async ({ actor, body, ip }) => {
  await undoClientImport(useDeps(), actor, body, { ip })
  return { undone: true as const }
})

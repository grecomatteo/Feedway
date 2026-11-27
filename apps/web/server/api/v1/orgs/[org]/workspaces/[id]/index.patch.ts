import { renameWorkspace, setDefaultPostTime, setDraftRetentionDays } from '@app/application'
import { renameWorkspaceRoute } from '@app/contracts'

// One field per request (the contract), each with its own permission (plan 06 Task 3).
export default defineApiRoute(renameWorkspaceRoute, ({ actor, params, body, ip }) => {
  if (body.name !== undefined)
    return renameWorkspace(useDeps(), actor, params.id, { name: body.name }, { ip })
  if (body.draftRetentionDays !== undefined)
    return setDraftRetentionDays(useDeps(), actor, params.id, body.draftRetentionDays, { ip })
  return setDefaultPostTime(useDeps(), actor, params.id, body.defaultPostTime ?? null, { ip })
})

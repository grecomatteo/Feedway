import { renameWorkspace, setDefaultPostTime } from '@app/application'
import { renameWorkspaceRoute } from '@app/contracts'

// One field per request (the contract), each with its own permission (plan 06 Task 3).
export default defineApiRoute(renameWorkspaceRoute, ({ actor, params, body, ip }) =>
  body.name !== undefined
    ? renameWorkspace(useDeps(), actor, params.id, { name: body.name }, { ip })
    : setDefaultPostTime(useDeps(), actor, params.id, body.defaultPostTime ?? null, { ip }),
)

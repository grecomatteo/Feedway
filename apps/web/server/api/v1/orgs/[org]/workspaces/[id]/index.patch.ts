import { renameWorkspace, setDefaultPostTime } from '@app/application'
import { renameWorkspaceRoute } from '@app/contracts'

// Two permissions, one field each (plan 06 Task 3): the panel changes one at a time.
export default defineApiRoute(renameWorkspaceRoute, async ({ actor, params, body, ip }) => {
  const deps = useDeps()
  let workspace =
    body.name === undefined
      ? undefined
      : await renameWorkspace(deps, actor, params.id, { name: body.name }, { ip })
  if (body.defaultPostTime !== undefined)
    workspace = await setDefaultPostTime(deps, actor, params.id, body.defaultPostTime, { ip })
  // the contract refuses a body with neither field
  if (!workspace) throw new Error('unreachable: an empty change')
  return workspace
})

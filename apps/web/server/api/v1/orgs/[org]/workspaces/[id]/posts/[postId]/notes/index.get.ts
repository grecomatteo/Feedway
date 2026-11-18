import { listNotes } from '@app/application'
import { listNotesRoute } from '@app/contracts'

export default defineApiRoute(listNotesRoute, ({ actor, params }) =>
  listNotes(useDeps(), actor, { workspaceId: params.id, postId: params.postId }),
)

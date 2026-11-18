import { addNote } from '@app/application'
import { addNoteRoute } from '@app/contracts'

export default defineApiRoute(
  addNoteRoute,
  ({ actor, params, body }) =>
    addNote(useDeps(), actor, { workspaceId: params.id, postId: params.postId, body: body.body }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)

import { deleteNote } from '@app/application'
import { deleteNoteRoute } from '@app/contracts'

export default defineApiRoute(
  deleteNoteRoute,
  async ({ actor, params }) => {
    await deleteNote(useDeps(), actor, {
      workspaceId: params.id,
      postId: params.postId,
      noteId: params.noteId,
    })
    return { deleted: true as const }
  },
  { rateLimit: POST_WRITES_RATE_LIMIT },
)

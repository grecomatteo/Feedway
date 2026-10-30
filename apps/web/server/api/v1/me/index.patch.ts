import { updateProfile } from '@app/application'
import { updateMeRoute } from '@app/contracts'

// The theme cookie follows on the page (Task 1): the profile is what reaches other devices.
export default defineApiRoute(updateMeRoute, async ({ body, session, ip }) => {
  const user = await updateProfile({ uow: useDeps().uow }, session.user, body, { ip })
  return { ...user, sessionState: session.state }
})

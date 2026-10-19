import { completeActivation } from '@app/application'

// After the passkey of a new account is registered, with the session the activation opened.
export default defineEventHandler(async (event) => {
  const limited = await limitLinkRoutes(event)
  if (limited) return limited
  const userId = await sessionUserId(event)
  if (userId === null) return linkError(event, 401, 'UNAUTHENTICATED', 'Accedi per continuare.')
  try {
    await completeActivation(identityDeps(useDeps()), {
      token: getRouterParam(event, 'token') ?? '',
      userId,
    })
    return { done: true }
  } catch (error) {
    return linkDomainError(event, error)
  }
})

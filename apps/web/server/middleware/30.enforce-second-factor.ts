import { allowedWhileSecondFactorRequired } from '@app/application'
import { isSecondFactorGatedAuthPath } from '@app/infrastructure'

/**
 * A session that still owes the second factor reaches only what
 * `allowedWhileSecondFactorRequired` allows (Task 13). On Better Auth's routes this covers the
 * account paths; sign-in paths stay open, and the code checks stay with the Better Auth hook,
 * which knows the sign-in cookie and repeats every check (Task 14).
 */
export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0] ?? ''
  if (path.startsWith('/api/auth/')) {
    if (!isSecondFactorGatedAuthPath(path.slice('/api/auth'.length))) return
  } else if (!path.startsWith('/api/v1/')) return
  const resolved = await loadSession(event)
  if (resolved?.state !== 'second_factor_required') return
  const factors = resolved.user.secondFactor
  if (allowedWhileSecondFactorRequired(event.method, path, factors)) return
  return sendApiError(event, secondFactorProblem(factors))
})

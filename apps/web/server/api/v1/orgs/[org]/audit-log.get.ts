import { listAuditLog, type AuditAction } from '@app/application'
import { auditLogRoute } from '@app/contracts'

export default defineApiRoute(auditLogRoute, ({ actor, query }) => {
  const { from, to, action, ...rest } = query
  return listAuditLog(useDeps(), actor, {
    ...rest,
    // checked against the list of actions by the use case
    ...(action === undefined ? {} : { action: action as AuditAction }),
    ...(from === undefined ? {} : { from: new Date(from) }),
    ...(to === undefined ? {} : { to: new Date(to) }),
  })
})

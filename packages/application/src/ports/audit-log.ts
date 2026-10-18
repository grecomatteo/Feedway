export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.login_failed',
  'auth.second_factor_failed',
  'auth.logout',
  'auth.password_changed',
  'auth.password_reset',
  'auth.email_change_requested',
  'auth.email_changed',
  'auth.totp_enabled',
  'auth.totp_disabled',
  'auth.backup_codes_regenerated',
  'auth.passkey_added',
  'auth.passkey_removed',
  'auth.reauthenticated',
  'auth.new_device',
  'auth.security_lock',
  'session.revoked',
  'user.invited',
  'user.activated',
  'user.disabled',
  'user.enabled',
  'user.role_changed',
  'user.password_reset_link',
  'user.profile_updated',
  'user.avatar_changed',
  'user.data_exported',
  'user.anonymized',
  'user.anonymization_scheduled',
  'user.anonymization_skipped',
  'organization.created',
  'organization.suspended',
  'organization.reactivated',
  'organization.limits_changed',
  'organization.settings_changed',
  'organization.ownership_transferred',
  'workspace.created',
  'workspace.renamed',
  'workspace.archived',
  'member.added',
  'member.role_changed',
  'member.removed',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export type AuditSource = 'panel' | 'api' | 'mcp' | 'system'

export interface AuditEntry {
  /** null: a personal entry of the actor, or a platform entry. */
  organizationId: string | null
  actorId: string | null
  source: AuditSource
  action: AuditAction
  entity: string
  entityId: string | null
  workspaceId: string | null
  ip: string | null
  data?: Record<string, unknown>
}

/** About the person, not an agency: always recorded with `organizationId: null`. */
export function isPersonalAuditAction(action: AuditAction): boolean {
  return (
    action.startsWith('auth.') ||
    action === 'user.profile_updated' ||
    action === 'user.avatar_changed' ||
    action === 'user.data_exported'
  )
}

/** Append-only; an entry is written in the same transaction as the change it describes. */
export interface AuditLog {
  record(entry: AuditEntry): Promise<void>
}

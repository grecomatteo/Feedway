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
  'auth.security_lock_notified',
  'auth.recovery_link_sent',
  'session.revoked',
  'user.invited',
  'user.invite_resent',
  'user.invite_revoked',
  'user.activated',
  'user.disabled',
  'user.identity_verified',
  'user.enabled',
  'user.access_reset',
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
  'organization.logo_changed',
  'organization.ownership_transferred',
  'workspace.created',
  'workspace.renamed',
  'workspace.archived',
  'member.added',
  'member.role_changed',
  'member.removed',
  'platform.mail_settings_changed',
  'platform.mail_test_sent',
  'integration.meta_changed',
  'integration.meta_tested',
  'connection.created',
  'connection.token_replaced',
  'accounts.imported',
  'account.assigned',
  'account.unassigned',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_SOURCES = ['panel', 'api', 'mcp', 'system'] as const

export type AuditSource = (typeof AUDIT_SOURCES)[number]

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

/** An agency's entry as stored; `position` is `createdAt` to the microsecond, in UTC. */
export interface AuditRecord {
  id: string
  organizationId: string
  actorId: string | null
  source: AuditSource
  action: AuditAction
  entity: string | null
  entityId: string | null
  workspaceId: string | null
  data: Record<string, unknown>
  createdAt: Date
  /** `YYYY-MM-DDTHH:MM:SS.ffffffZ`: a JavaScript date would round the microseconds away. */
  position: string
}

export interface AuditQuery {
  organizationId: string
  workspaceId?: string
  actorId?: string
  action?: AuditAction
  source?: AuditSource
  /** Inclusive. */
  from?: Date
  /** Exclusive. */
  to?: Date
  /** Entries strictly older than this one, in (created_at, id) order. */
  after?: { position: string; id: string }
  limit: number
}

/** One of the person's own entries, for "Scarica i miei dati": the IP included. */
export interface OwnAuditRecord {
  id: string
  /** null: a personal or platform entry. */
  organizationId: string | null
  actorId: string
  source: AuditSource
  action: AuditAction
  entity: string | null
  entityId: string | null
  workspaceId: string | null
  ip: string | null
  data: Record<string, unknown>
  createdAt: Date
  position: string
}

/** Append-only; an entry is written in the same transaction as the change it describes. */
export interface AuditLog {
  record(entry: AuditEntry): Promise<void>
  /** Entries of one agency only (never those without one), newest first, ties broken by id. */
  listForOrganization(query: AuditQuery): Promise<AuditRecord[]>
  /**
   * What `actorId` did: in one agency, or (`organizationId: null`) the entries with no agency,
   * readable only in the person's own scope. Newest first, as `listForOrganization`.
   */
  listOwn(query: {
    organizationId: string | null
    actorId: string
    after?: { position: string; id: string }
    limit: number
  }): Promise<OwnAuditRecord[]>
  /**
   * Whether an entry like this is already recorded (to record it once when a step is repeated).
   * `organizationId: null` looks only at entries with no agency, which row level security shows
   * to their author or in the system scope.
   */
  exists(query: {
    organizationId: string | null
    action: AuditAction
    entityId: string
    /** Any source when left out. */
    source?: AuditSource
  }): Promise<boolean>
  /** The newest entry like this, with its time and data; same visibility as `exists`. */
  latest(query: {
    organizationId: string | null
    action: AuditAction
    entityId: string
  }): Promise<{ createdAt: Date; data: Record<string, unknown> } | null>
  /** Shortens the IPs of entries older than `before` (§15.7); returns how many. */
  shortenIpsBefore(before: Date): Promise<number>
}

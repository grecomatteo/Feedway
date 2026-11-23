// The events of the platform (§12.2): `organization_id` null, read only by the system scope.

export const PLATFORM_EVENT_TYPES = [
  /** no worker beat for 2 minutes; written by the web, already sent (plan 08, Scelta 10) */
  'system.worker_down',
  'system.worker_up',
  /** written by stage 11 */
  'system.backup_failed',
] as const

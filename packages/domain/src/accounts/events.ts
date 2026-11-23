// The events about the social accounts and Meta (§12.2, plan 08 Task 4). The publishing writes
// the quota's; the account jobs the others, only when the state changes.

export const ACCOUNT_EVENT_TYPES = [
  /** Instagram's quota below 10%, once per window (D-111) */
  'account.quota_low',
  /** a connection's token stopped working: expired or access taken back */
  'account.token_invalid',
  /** an account's health turned worse */
  'account.unhealthy',
  /** a Meta reminder of §8.4, once per reminder and due date */
  'meta.reminder',
] as const

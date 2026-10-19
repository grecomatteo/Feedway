export { createAuthEventSink, lockAccountFromSecurityEmail, readableDevice } from './auth-events.js'
export type {
  AuthEvent,
  AuthEventContext,
  AuthEventDeps,
  AuthEventSink,
  LockDeps,
} from './auth-events.js'
export { LOCK_LINK_TTL_MS, LOCK_PAGE_PATH, sendSecurityEmail } from './security-emails.js'
export type { SecurityEmailDeps } from './security-emails.js'

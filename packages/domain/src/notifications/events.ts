import { ACCOUNT_EVENT_TYPES } from '../accounts/events.js'
import { PLATFORM_EVENT_TYPES } from '../platform/events.js'
import { PUBLISHING_EVENT_TYPES } from '../publishing/events.js'

/** Every type the outbox holds: the union of the modules' lists (plan 08, «Registro dei tipi»). */
export const OUTBOX_EVENT_TYPES = [
  ...PUBLISHING_EVENT_TYPES,
  ...ACCOUNT_EVENT_TYPES,
  ...PLATFORM_EVENT_TYPES,
] as const
export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number]

/** Ids and codes only: never a text, a name or a token (plan 07 «Eventi»). */
export type OutboxPayload = Readonly<Record<string, string | number | boolean | null>>

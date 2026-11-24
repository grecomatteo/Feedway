import { z } from 'zod'
import { defineContract } from './define.js'
import { Id, Timestamp } from './common.js'

// The notification centre, the bell and the person's choices (§12.3, plan 08 Task 6, P4, P6):
// a person's own, in every agency where they work, so under `/api/v1/me/`.

/** The lists of `@app/domain` (`notifications/`): a test of the panel keeps them equal. */
export const NotificationLevel = z.enum([
  'info',
  'success',
  'warning',
  'error',
  'critical',
  'security',
])
export const NotificationChannel = z.enum(['panel', 'telegram', 'email'])
export const NotificationKindName = z.enum([
  'post.target_confirmed',
  'post.confirmed',
  'post.target_failed',
  'post.target_problem',
  'post.paused',
  'post.file_wont_publish',
  'account.quota_low',
  'account.token_invalid',
  'account.unhealthy',
  'meta.reminder',
  'system.worker_down',
  'system.worker_up',
  'system.backup_failed',
])
export type NotificationLevel = z.infer<typeof NotificationLevel>
export type NotificationChannel = z.infer<typeof NotificationChannel>
export type NotificationKindName = z.infer<typeof NotificationKindName>

export const NotificationDelivery = z.object({
  channel: NotificationChannel,
  status: z.enum(['pending', 'sending', 'sent', 'failed', 'skipped']),
  /** Translated, never a secret or a server's answer */
  error: z.string().nullable(),
  sentAt: Timestamp.nullable(),
})

export const NotificationItem = z.object({
  id: Id,
  kind: NotificationKindName,
  level: NotificationLevel,
  createdAt: Timestamp,
  readAt: Timestamp.nullable(),
  /** null: the platform's */
  organization: z.object({ id: Id, slug: z.string(), name: z.string() }).nullable(),
  workspaceId: Id.nullable(),
  title: z.string(),
  detail: z.string().nullable(),
  context: z.string().nullable(),
  /** A path of the panel */
  link: z.object({ label: z.string(), path: z.string() }).nullable(),
  deliveries: z.array(NotificationDelivery),
})
export type NotificationItem = z.infer<typeof NotificationItem>

export const NotificationPage = z.object({
  items: z.array(NotificationItem),
  /** The next page's `cursor`; null: no more */
  nextCursor: z.string().nullable(),
  /** Every unread one the person sees, whatever the filters: the bell's number */
  unread: z.number().int(),
})
export type NotificationPage = z.infer<typeof NotificationPage>

export const myNotificationsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/me/notifications',
  summary: 'Le notifiche della persona collegata, dalla più recente, con lo stato per canale',
  request: {
    query: z.strictObject({
      organizationId: Id.optional(),
      workspaceId: Id.optional(),
      level: NotificationLevel.optional(),
      kind: NotificationKindName.optional(),
      /** `true`: only the unread ones */
      unread: z.enum(['true', 'false']).optional(),
      cursor: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
  response: NotificationPage,
  auth: 'session',
  scope: 'personal',
})

export const UnreadNotifications = z.object({ unread: z.number().int() })

export const myUnreadNotificationsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/me/notifications/unread',
  summary: 'Quante notifiche non lette ha la persona collegata (la campanella)',
  request: {},
  response: UnreadNotifications,
  auth: 'session',
  scope: 'personal',
})

export const readMyNotificationRoute = defineContract({
  method: 'POST',
  path: '/api/v1/me/notifications/{id}/read',
  summary: 'Segna come letta una notifica della persona collegata',
  request: { params: z.strictObject({ id: Id }) },
  response: UnreadNotifications,
  auth: 'session',
  scope: 'personal',
})

export const readAllMyNotificationsRoute = defineContract({
  method: 'POST',
  path: '/api/v1/me/notifications/read-all',
  summary: 'Segna come lette tutte le notifiche della persona collegata',
  request: {},
  response: UnreadNotifications,
  auth: 'session',
  scope: 'personal',
})

/** Where the digest can go: the panel keeps the events, not the digest */
export const DigestChannel = z.enum(['email', 'telegram'])
export type DigestChannel = z.infer<typeof DigestChannel>

/** At least one */
const DigestChannels = z
  .array(DigestChannel)
  .min(1, 'Scegli almeno un canale per il riepilogo')
  .max(2)

const HhMm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Ora non valida')

export const NotificationSettings = z.object({
  /** Below it, only the panel */
  minLevel: NotificationLevel,
  /** null: off */
  quietHours: z.object({ start: HhMm, end: HhMm }).nullable(),
  digest: z.object({
    enabled: z.boolean(),
    time: HhMm,
    /** ISO weekdays, 1 = Monday */
    days: z.array(z.number().int().min(1).max(7)).max(7),
    channels: DigestChannels,
  }),
  /** «Tutto ovunque», for tests */
  everythingEverywhere: z.boolean(),
})
export type NotificationSettings = z.infer<typeof NotificationSettings>

export const NotificationPreferences = z.object({
  settings: NotificationSettings,
  /** Only the kinds the person can get */
  kinds: z.array(
    z.object({
      kind: NotificationKindName,
      level: NotificationLevel,
      defaultChannels: z.array(NotificationChannel),
      channels: z.array(NotificationChannel),
      changed: z.boolean(),
      /** D-74: the email reaches who scheduled the post whatever they choose */
      alwaysEmailToScheduler: z.boolean(),
    }),
  ),
})
export type NotificationPreferences = z.infer<typeof NotificationPreferences>

export const myNotificationPreferencesRoute = defineContract({
  method: 'GET',
  path: '/api/v1/me/notifications/preferences',
  summary:
    'Cosa riceve la persona collegata e dove, per tipo, con le ore di silenzio e il riepilogo',
  request: {},
  response: NotificationPreferences,
  auth: 'session',
  scope: 'personal',
})

export const saveMyNotificationSettingsRoute = defineContract({
  method: 'PUT',
  path: '/api/v1/me/notifications/preferences',
  summary: 'Cambia livello minimo, ore di silenzio, riepilogo e «Tutto ovunque»',
  request: {
    body: z.strictObject({
      minLevel: NotificationLevel,
      quietHours: z.strictObject({ start: HhMm, end: HhMm }).nullable(),
      digest: z.strictObject({
        enabled: z.boolean(),
        time: HhMm,
        days: z.array(z.number().int().min(1).max(7)).max(7),
        channels: DigestChannels,
      }),
      everythingEverywhere: z.boolean(),
    }),
  },
  response: NotificationPreferences,
  auth: 'session',
  scope: 'personal',
})

export const setMyNotificationKindRoute = defineContract({
  method: 'PUT',
  path: '/api/v1/me/notifications/preferences/kinds',
  summary: 'Cambia i canali di un tipo di notifica; null torna ai predefiniti',
  request: {
    body: z.strictObject({
      kind: NotificationKindName,
      /** none: the kind is off */
      channels: z.array(NotificationChannel).max(3).nullable(),
    }),
  },
  response: NotificationPreferences,
  auth: 'session',
  scope: 'personal',
})

export const notificationRoutes = [
  myNotificationsRoute,
  myUnreadNotificationsRoute,
  readMyNotificationRoute,
  readAllMyNotificationsRoute,
  myNotificationPreferencesRoute,
  saveMyNotificationSettingsRoute,
  setMyNotificationKindRoute,
] as const

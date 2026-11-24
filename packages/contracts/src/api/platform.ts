import { z } from 'zod'
import { defineContract } from './define.js'
import { Timestamp } from './common.js'
import { ReplaceTelegramBotBody, TelegramBot } from './integrations.js'

// The platform administrator's routes (`platformRole = 'admin'`): anyone else gets 404, as if
// they did not exist. Changes need a recent reauth (ADR 017).

const SmtpPort = z.union([z.literal(465), z.literal(587), z.literal(2525)])
const SmtpSecurity = z.enum(['tls', 'starttls'])

/** The system email as the panel shows it: never the password, not even part of it. */
export const PlatformMailSettings = z.object({
  host: z.string(),
  port: SmtpPort,
  security: SmtpSecurity,
  username: z.string(),
  from: z.string(),
  /** A password is stored; its value never leaves the server. */
  passwordSet: z.literal(true),
  verifiedAt: Timestamp.nullable(),
  updatedAt: Timestamp,
})
export type PlatformMailSettings = z.infer<typeof PlatformMailSettings>

export const platformMailSettingsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/platform/mail-settings',
  summary: 'L’email di sistema (SMTP della piattaforma), senza la password',
  request: {},
  response: z.object({ settings: PlatformMailSettings.nullable() }),
  auth: 'session',
  scope: 'platform',
})

/** The adapter checks host, sender and port; these limits only keep junk out. */
export const ReplacePlatformMailSettingsBody = z.strictObject({
  host: z.string().min(1).max(253),
  port: SmtpPort,
  /** Left out: TLS on 465, STARTTLS on 587 and 2525. */
  security: SmtpSecurity.optional(),
  username: z.string().min(1).max(254),
  from: z.string().min(3).max(254),
  /** Left out: the stored password stays. */
  password: z.string().min(1).max(1024).optional(),
})

export const replacePlatformMailSettingsRoute = defineContract({
  method: 'PUT',
  path: '/api/v1/platform/mail-settings',
  summary: 'Cambia l’email di sistema (con riconferma); la password resta se non la mandi',
  request: { body: ReplacePlatformMailSettingsBody },
  response: z.object({ settings: PlatformMailSettings }),
  auth: 'session',
  scope: 'platform',
})

export const MailTestKind = z.enum([
  'sent',
  'not_configured',
  'unexpected',
  'invalid_config',
  'blocked_destination',
  'dns',
  'timeout',
  'tls',
  'auth',
  'connection',
  'rejected',
])

export const platformMailTestRoute = defineContract({
  method: 'POST',
  path: '/api/v1/platform/mail-settings/test',
  summary: 'Manda un’email di prova con l’email di sistema (con riconferma)',
  request: { body: z.strictObject({ to: z.string().min(3).max(254) }) },
  response: z.object({
    ok: z.boolean(),
    kind: MailTestKind,
    /** The server's reply, already without credentials or addresses. */
    response: z.string().nullable(),
  }),
  auth: 'session',
  scope: 'platform',
})

export const platformTelegramBotRoute = defineContract({
  method: 'GET',
  path: '/api/v1/platform/telegram-bot',
  summary: 'Il bot Telegram della piattaforma, senza il token',
  request: {},
  response: z.object({ bot: TelegramBot.nullable() }),
  auth: 'session',
  scope: 'platform',
})

export const replacePlatformTelegramBotRoute = defineContract({
  method: 'PUT',
  path: '/api/v1/platform/telegram-bot',
  summary:
    'Imposta il bot Telegram della piattaforma (con riconferma): si salva solo se Telegram lo accetta',
  request: { body: ReplaceTelegramBotBody },
  response: z.object({ bot: TelegramBot }),
  auth: 'session',
  scope: 'platform',
})

export const removePlatformTelegramBotRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/platform/telegram-bot',
  summary: 'Toglie il bot Telegram della piattaforma (con riconferma)',
  request: {},
  response: z.object({ ok: z.literal(true) }),
  auth: 'session',
  scope: 'platform',
})

export const platformRoutes = [
  platformMailSettingsRoute,
  replacePlatformMailSettingsRoute,
  platformMailTestRoute,
  platformTelegramBotRoute,
  replacePlatformTelegramBotRoute,
  removePlatformTelegramBotRoute,
] as const

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

/** One worker instance's last beat (§16.7): green, amber past a minute, red past two. */
export const WorkerBeat = z.object({
  instance: z.string(),
  lastBeatAt: Timestamp,
  health: z.enum(['ok', 'late', 'silent']),
  version: z.string().nullable(),
})
export type WorkerBeat = z.infer<typeof WorkerBeat>

/** The last call to the external watch: codes only, never the address. */
export const ExternalWatchOutcome = z.object({
  at: Timestamp,
  ok: z.boolean(),
  status: z.number().int().nullable(),
  problem: z.enum(['timeout', 'network', 'status']).nullable(),
})
export type ExternalWatchOutcome = z.infer<typeof ExternalWatchOutcome>

export const PlatformMonitoring = z.object({
  workers: z.array(WorkerBeat),
  /** null: no address set. The address itself never leaves the server. */
  external: z
    .object({
      addressSet: z.literal(true),
      updatedAt: Timestamp,
      last: ExternalWatchOutcome.nullable(),
    })
    .nullable(),
})
export type PlatformMonitoring = z.infer<typeof PlatformMonitoring>

export const platformMonitoringRoute = defineContract({
  method: 'GET',
  path: '/api/v1/platform/monitoring',
  summary: 'Ultimo battito di ogni worker e sorveglianza esterna, senza l’indirizzo',
  request: {},
  response: PlatformMonitoring,
  auth: 'session',
  scope: 'platform',
})

export const replaceExternalWatchRoute = defineContract({
  method: 'PUT',
  path: '/api/v1/platform/external-watch',
  summary: 'Imposta l’indirizzo della sorveglianza esterna (healthchecks.io, con riconferma)',
  request: { body: z.strictObject({ url: z.string().min(1).max(512) }) },
  response: z.object({ ok: z.literal(true) }),
  auth: 'session',
  scope: 'platform',
})

export const removeExternalWatchRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/platform/external-watch',
  summary: 'Toglie l’indirizzo della sorveglianza esterna (con riconferma)',
  request: {},
  response: z.object({ ok: z.literal(true) }),
  auth: 'session',
  scope: 'platform',
})

export const testExternalWatchRoute = defineContract({
  method: 'POST',
  path: '/api/v1/platform/external-watch/test',
  summary: 'Chiama adesso la sorveglianza esterna e ne salva l’esito',
  request: {},
  response: z.object({ configured: z.boolean(), last: ExternalWatchOutcome.nullable() }),
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
  platformMonitoringRoute,
  replaceExternalWatchRoute,
  removeExternalWatchRoute,
  testExternalWatchRoute,
] as const

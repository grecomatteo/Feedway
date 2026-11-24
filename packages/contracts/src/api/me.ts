import { z } from 'zod'
import { defineContract } from './define.js'
import { Id, OrgRole, Timestamp } from './common.js'

/** The colour palettes of the panel (`packages/ui`): Feedway is the default. */
export const Palette = z.enum(['feedway', 'blu', 'verde', 'viola', 'grafite'])
export type Palette = z.infer<typeof Palette>

const MyOrganization = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  role: OrgRole,
  status: z.enum(['active', 'suspended']),
  /** The 256 px logo in the panel (`/64` for the small one); null: the initials. */
  logoUrl: z.string().nullable(),
})

/** The signed-in person: their own data only, never a hash, token or secret. */
export const Me = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  nickname: z.string().nullable(),
  displayName: z.string(),
  platformRole: z.literal('admin').nullable(),
  avatarUrl: z.string().nullable(),
  theme: z.enum(['light', 'dark', 'system']),
  palette: Palette,
  locale: z.string(),
  timezone: z.string().nullable(),
  lastOrganizationSlug: z.string().nullable(),
  organizations: z.array(MyOrganization),
  secondFactor: z.object({
    required: z.boolean(),
    totpEnabled: z.boolean(),
    passkeys: z.number().int(),
  }),
  /** False for an account that signs in with passkeys only, or that has no way in yet. */
  hasPassword: z.boolean(),
  /** The platform sends email: security notices (password changed…) reach the person. */
  emailNotices: z.boolean(),
  /** `second_factor_required`: the panel shows only the second factor setup. */
  sessionState: z.enum(['active', 'second_factor_required']),
})
export type Me = z.infer<typeof Me>

export const meRoute = defineContract({
  method: 'GET',
  path: '/api/v1/me',
  summary: 'La persona collegata e lo stato della sessione',
  request: {},
  response: Me,
  // also while the second factor is owed: the gate lets it through only before any factor exists
  auth: 'session_any_state',
  scope: 'personal',
})

/** Only the fields sent change; the others stay as they are. */
export const updateMeRoute = defineContract({
  method: 'PATCH',
  path: '/api/v1/me',
  summary: 'Cambia nome, soprannome, tema, colori o fuso orario della persona collegata',
  request: {
    body: z.strictObject({
      name: z.string().max(200).optional(),
      nickname: z.string().max(200).nullable().optional(),
      theme: z.enum(['light', 'dark', 'system']).optional(),
      palette: Palette.optional(),
      timezone: z.string().max(64).nullable().optional(),
    }),
  },
  response: Me,
  auth: 'session',
  scope: 'personal',
})

export const myOrganizationsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/me/organizations',
  summary: 'Le agenzie della persona, per il selettore',
  request: {},
  response: z.object({ items: z.array(MyOrganization) }),
  auth: 'session',
  scope: 'personal',
})

export const PasskeySummary = z.object({
  id: z.string(),
  name: z.string().nullable(),
  createdAt: Timestamp.nullable(),
  deviceType: z.enum(['singleDevice', 'multiDevice']),
  backedUp: z.boolean(),
})

export const mySecondFactorRoute = defineContract({
  method: 'GET',
  path: '/api/v1/me/second-factor',
  summary: 'I secondi fattori della persona e se sono obbligatori',
  request: {},
  response: z.object({
    required: z.boolean(),
    totpEnabled: z.boolean(),
    passkeys: z.array(PasskeySummary),
  }),
  auth: 'session',
  scope: 'personal',
})

/** A signed-in device: never the token, never the full address. */
export const MySession = z.object({
  id: z.string(),
  device: z.object({ browser: z.string(), os: z.string() }),
  ipApprox: z.string().nullable(),
  createdAt: Timestamp,
  lastActiveAt: Timestamp,
  current: z.boolean(),
})

export const mySessionsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/me/sessions',
  summary: 'I dispositivi collegati',
  request: {},
  response: z.object({ items: z.array(MySession) }),
  auth: 'session',
  scope: 'personal',
})

export const revokeMySessionRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/me/sessions/{id}',
  summary: 'Scollega un dispositivo',
  request: { params: z.strictObject({ id: Id }) },
  response: z.object({ revoked: z.literal(true) }),
  auth: 'session',
  scope: 'personal',
})

export const revokeAllMySessionsRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/me/sessions',
  summary: 'Esce da tutti i dispositivi, questo compreso',
  request: {},
  response: z.object({ revoked: z.number().int() }),
  auth: 'session',
  scope: 'personal',
})

/** Only for an account without a password; a password already set changes with the current one. */
export const setMyPasswordRoute = defineContract({
  method: 'POST',
  path: '/api/v1/me/password',
  summary: 'Imposta la prima password di un account che non ne ha',
  request: { body: z.strictObject({ password: z.string().min(1).max(1024) }) },
  response: z.object({ passwordSet: z.literal(true) }),
  auth: 'session_any_state',
  scope: 'personal',
})

/** A bot that writes to the person (plan 08 Task 7): the platform's, or an agency's own. */
export const MyTelegramBot = z.object({
  /** `platform`, or the id of the agency whose own bot it is */
  bot: z.string(),
  botUsername: z.string(),
  /** The agencies whose notifications come through it, by name */
  agencies: z.array(z.string()),
  /** The platform's notifications come through it too */
  platform: z.boolean(),
  linkedAt: Timestamp.nullable(),
  /** A link was opened and waits for «Avvia» until then */
  pendingUntil: Timestamp.nullable(),
})
export type MyTelegramBot = z.infer<typeof MyTelegramBot>

const TelegramBotKey = z.string().min(1).max(64)

export const myTelegramRoute = defineContract({
  method: 'GET',
  path: '/api/v1/me/telegram',
  summary: 'I bot di Telegram che scrivono alla persona, e se è collegata',
  request: {},
  response: z.object({ bots: z.array(MyTelegramBot) }),
  auth: 'session',
  scope: 'personal',
})

export const startMyTelegramLinkRoute = defineContract({
  method: 'POST',
  path: '/api/v1/me/telegram/links',
  summary: 'Un collegamento nuovo con un bot: l’indirizzo t.me da aprire, valido 15 minuti',
  request: { body: z.strictObject({ bot: TelegramBotKey }) },
  response: z.object({ url: z.string(), expiresAt: Timestamp }),
  auth: 'session',
  scope: 'personal',
})

export const unlinkMyTelegramRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/me/telegram/links/{bot}',
  summary: 'Scollega Telegram da un bot',
  request: { params: z.strictObject({ bot: TelegramBotKey }) },
  response: z.object({ ok: z.literal(true) }),
  auth: 'session',
  scope: 'personal',
})

export const meRoutes = [
  meRoute,
  updateMeRoute,
  myOrganizationsRoute,
  mySecondFactorRoute,
  mySessionsRoute,
  revokeMySessionRoute,
  revokeAllMySessionsRoute,
  setMyPasswordRoute,
  myTelegramRoute,
  startMyTelegramLinkRoute,
  unlinkMyTelegramRoute,
] as const

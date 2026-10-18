// Better Auth tables (shape from `@better-auth/cli generate` 1.7.10 with twoFactor + passkey,
// usePlural) adapted to our conventions, plus our personal data. The object keys are the model
// names the Drizzle adapter looks up with `usePlural: true`. No organization_id and no RLS here:
// these rows belong to a person, not to an agency.
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core'
import { bytea, citext, createdAt, inList, tz, updatedAt } from '../columns.js'

const userRef = () =>
  uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })

export const AUTH_METHODS = [
  'activation',
  'password',
  'password_totp',
  'password_backup_code',
  'passkey',
] as const

export const DATA_EXPORT_STATUSES = ['pending', 'running', 'ready', 'failed', 'expired'] as const

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    email: citext('email').notNull().unique(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    twoFactorEnabled: boolean('two_factor_enabled').default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // The 30-grapheme limit is a domain rule; this check is only a safety net.
    nickname: text('nickname'),
    avatarKey: text('avatar_key'),
    platformRole: text('platform_role'),
    status: text('status').default('active').notNull(),
    disabledAt: tz('disabled_at'),
    theme: text('theme').default('system').notNull(),
    locale: text('locale').default('it').notNull(),
    // null: the organization's time zone, or TZ_DEFAULT
    timezone: text('timezone'),
    // No foreign key: organizations belong to another module.
    lastOrganizationId: uuid('last_organization_id'),
    lastLoginAt: tz('last_login_at'),
    anonymizedAt: tz('anonymized_at'),
  },
  (t) => [
    check('users_nickname_length', sql`char_length(${t.nickname}) <= 120`),
    check('users_platform_role', inList('platform_role', ['admin'])),
    check('users_status', inList('status', ['active', 'disabled'])),
    check('users_theme', inList('theme', ['light', 'dark', 'system'])),
  ],
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    expiresAt: tz('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: tz('updated_at')
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: userRef(),
    reauthenticatedAt: tz('reauthenticated_at'),
    authMethod: text('auth_method').default('password').notNull(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
    check('sessions_auth_method', inList('auth_method', AUTH_METHODS)),
  ],
)

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: userRef(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: tz('access_token_expires_at'),
    refreshTokenExpiresAt: tz('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: tz('updated_at')
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index('accounts_user_id_idx').on(t.userId)],
)

export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: tz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
)

export const twoFactors = pgTable(
  'two_factors',
  {
    id: uuid('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: userRef(),
    verified: boolean('verified').default(true),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: tz('locked_until'),
  },
  (t) => [
    index('two_factors_secret_idx').on(t.secret),
    index('two_factors_user_id_idx').on(t.userId),
  ],
)

export const passkeys = pgTable(
  'passkeys',
  {
    id: uuid('id').primaryKey(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: userRef(),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    createdAt: tz('created_at'),
    aaguid: text('aaguid'),
  },
  (t) => [
    index('passkeys_user_id_idx').on(t.userId),
    index('passkeys_credential_id_idx').on(t.credentialID),
  ],
)

export const rateLimits = pgTable('rate_limits', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
})

export const knownDevices = pgTable(
  'known_devices',
  {
    userId: userRef(),
    deviceHash: bytea('device_hash').notNull(),
    firstSeenAt: tz('first_seen_at').defaultNow().notNull(),
    lastSeenAt: tz('last_seen_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deviceHash] })],
)

export const dataExports = pgTable(
  'data_exports',
  {
    id: uuid('id').primaryKey(),
    userId: userRef(),
    status: text('status').default('pending').notNull(),
    storageKey: text('storage_key'),
    expiresAt: tz('expires_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('data_exports_user_id_created_at_idx').on(t.userId, t.createdAt.desc()),
    check('data_exports_status', inList('status', DATA_EXPORT_STATUSES)),
  ],
)

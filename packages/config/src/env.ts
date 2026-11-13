import { readFileSync } from 'node:fs'
import { posix } from 'node:path'
import { IANAZone } from 'luxon'
import { z } from 'zod'

export type ConfigRole = 'web' | 'worker' | 'migrate'

export interface ConfigIssue {
  variable: string
  problem: string
}

/** Lists `VARIABLE: problem` per line and never the values (they may be secrets). */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[]

  constructor(issues: readonly ConfigIssue[]) {
    super(
      ['Configurazione non valida:', ...issues.map((i) => `${i.variable}: ${i.problem}`)].join(
        '\n',
      ),
    )
    this.name = 'ConfigError'
    this.issues = issues
  }
}

// Mirrors QUEUE_NAMES in @app/infrastructure; kept here so config has no dependencies on it.
export const KNOWN_QUEUES = [
  'system.selftest',
  'identity.security_email',
  'identity.password_reset_email',
  'identity.account_locked_notice',
  'identity.account_locked_notice_email',
  'identity.account_recovery_email',
  'identity.email_change',
  'identity.data_export',
  'identity.retention',
  'identity.anonymization_notice',
  'accounts.sync',
  'accounts.health',
  'accounts.daily',
  'accounts.avatar',
] as const

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const

// Retirement dates from Meta's "Versions" page, read 2026-11-09 (docs/platforms/meta.md).
const META_GRAPH_SUNSETS: Readonly<Record<string, string>> = {
  'v24.0': '2028-02-18',
  'v25.0': '2028-07-29',
}

const RESOLVABLE = [
  'DATABASE_URL',
  'DATABASE_MIGRATOR_URL',
  'APP_ENCRYPTION_KEY',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_SECRETS',
  'PANEL_URL',
  'PUBLIC_URL',
  'META_GRAPH_VERSION',
  'META_GRAPH_VERSION_SUNSET',
  'META_MODE',
  'META_MOCK_URL',
  'META_RECORD_DIR',
  'TZ_DEFAULT',
  'MEDIA_RETENTION_DAYS',
  'MEDIA_ROOT',
  'MEDIA_UPLOAD_DIR',
  'MEDIA_MAX_VIDEO_BYTES',
  'MEDIA_MAX_IMAGE_BYTES',
  'MEDIA_MAX_IMAGE_PIXELS',
  'MEDIA_MAX_VIDEO_SECONDS',
  'MEDIA_MAX_VIDEO_PIXELS',
  'MEDIA_WORKSPACE_MAX_BYTES',
  'MEDIA_CONVERSIONS_PER_ORG',
  'STORAGE_DRIVER',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE',
  'REQUIRE_2FA',
  'BOOTSTRAP_OWNER_EMAIL',
  'BOOTSTRAP_ORGANIZATION_NAME',
  'SENTRY_DSN',
  'LOG_LEVEL',
  'DATABASE_RUNTIME_ROLE',
  'WORKER_QUEUES',
  'NODE_ENV',
  'APP_TEST_ROUTES',
] as const

type Raw = Partial<Record<(typeof RESOLVABLE)[number], string>>

const isLocalHost = (url: URL) =>
  url.hostname === 'localhost' || url.hostname.endsWith('.localhost')

const url = z.url({ error: 'deve essere un indirizzo valido' })

/** Where `pnpm --filter @app/meta-mock start` listens (META_MOCK_PORT 4010). */
const DEFAULT_META_MOCK_URL = 'http://127.0.0.1:4010'
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v)
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(emptyToUndefined, schema.optional())
const withDefault = <V extends string | number>(schema: z.ZodType<V>, value: V) =>
  z.preprocess(emptyToUndefined, schema.default(value))

const absolutePath = z.string().regex(/^\/[^\0]*$/, { error: 'deve essere un percorso assoluto' })
const positiveInt = z.coerce
  .number({ error: 'deve essere un intero' })
  .int({ error: 'deve essere un intero' })
  .min(1, { error: 'deve essere almeno 1' })

const trimSlash = (p: string) => posix.normalize(p).replace(/(.)\/+$/, '$1')

/** The chunk folder must not hold or overlap the storage keys (`org/`, `users/`) of the disk. */
function isOutsideKeys(dir: string, root: string): boolean {
  const d = trimSlash(dir)
  const r = trimSlash(root)
  if (d === r || r.startsWith(`${d}/`) || d === '/') return false
  return ['org', 'users'].every((k) => d !== `${r}/${k}` && !d.startsWith(`${r}/${k}/`))
}

const isKey32 = (v: string) =>
  /^[A-Za-z0-9+/]+={0,2}$/.test(v) && Buffer.from(v, 'base64').length === 32

const encryptionKey = z
  .string({ error: 'obbligatoria' })
  .refine(isKey32, { error: 'deve essere di 32 byte in base64' })
  .transform((v) => Buffer.from(v, 'base64'))

export interface BetterAuthSecrets {
  /** The current secret. */
  secret: string
  /** Every secret still accepted, newest version first (rotation). */
  secrets: { version: number; value: string }[]
}

const BETTER_AUTH_SECRETS_FORM =
  'deve avere la forma 2:nuovo,1:vecchio, chiavi di 32 byte in base64'

/** Parses `2:new,1:old`; null when the value does not have that form. */
function parseSecretVersions(value: string): { version: number; value: string }[] | null {
  const entries = value.split(',').map((part) => {
    const at = part.indexOf(':')
    const version = Number(part.slice(0, at))
    const secret = part.slice(at + 1).trim()
    return at > 0 && Number.isInteger(version) && version > 0 && isKey32(secret)
      ? { version, value: secret }
      : null
  })
  if (entries.some((e) => e === null)) return null
  const valid = entries.filter((e) => e !== null)
  if (new Set(valid.map((e) => e.version)).size !== valid.length) return null
  return valid.sort((a, b) => b.version - a.version)
}

const appSchema = z
  .object({
    NODE_ENV: withDefault(z.enum(['development', 'test', 'production']), 'development'),
    DATABASE_URL: z.string({ error: 'obbligatoria' }).min(1, 'obbligatoria'),
    APP_ENCRYPTION_KEY: encryptionKey,
    BETTER_AUTH_SECRET: optional(
      z.string().refine(isKey32, { error: 'deve essere di 32 byte in base64' }),
    ),
    BETTER_AUTH_SECRETS: optional(z.string()),
    PANEL_URL: z.string({ error: 'obbligatoria' }).pipe(url),
    PUBLIC_URL: optional(url),
    META_GRAPH_VERSION: withDefault(
      z.string().regex(/^v\d+\.\d+$/, { error: 'deve avere la forma v25.0' }),
      'v25.0',
    ),
    META_GRAPH_VERSION_SUNSET: optional(z.iso.date({ error: 'deve essere una data AAAA-MM-GG' })),
    META_MODE: withDefault(z.enum(['live', 'mock', 'dry-run']), 'live'),
    META_RECORD_DIR: optional(z.string().min(1)),
    META_MOCK_URL: optional(url),
    TZ_DEFAULT: withDefault(
      z.string().refine((v) => IANAZone.isValidZone(v), { error: 'fuso orario non valido' }),
      'Europe/Rome',
    ),
    MEDIA_RETENTION_DAYS: withDefault(
      z.coerce.number().int({ error: 'deve essere un intero' }).min(1).max(365, {
        error: 'deve essere tra 1 e 365',
      }),
      7,
    ),
    MEDIA_ROOT: withDefault(absolutePath, '/media'),
    // inside the media volume but outside the storage keys (org/, users/); default MEDIA_ROOT/uploads
    MEDIA_UPLOAD_DIR: optional(absolutePath),
    // spec §9.2; decimal MB, so never above what Meta accepts
    MEDIA_MAX_VIDEO_BYTES: withDefault(positiveInt, 300_000_000),
    MEDIA_MAX_IMAGE_BYTES: withDefault(positiveInt, 50_000_000),
    MEDIA_MAX_IMAGE_PIXELS: withDefault(positiveInt, 50_000_000),
    MEDIA_MAX_VIDEO_SECONDS: withDefault(positiveInt, 900),
    MEDIA_MAX_VIDEO_PIXELS: withDefault(positiveInt, 4096 * 4096),
    MEDIA_WORKSPACE_MAX_BYTES: optional(positiveInt),
    MEDIA_CONVERSIONS_PER_ORG: withDefault(positiveInt, 1),
    STORAGE_DRIVER: withDefault(z.enum(['disk', 's3'], { error: 'deve essere disk o s3' }), 'disk'),
    S3_ENDPOINT: optional(
      url.refine((v) => /^https?:\/\//i.test(v), { error: 'deve usare http o https' }),
    ),
    S3_BUCKET: optional(z.string().trim().min(1, { error: 'non può essere vuota' })),
    S3_REGION: withDefault(z.string(), 'auto'),
    S3_ACCESS_KEY_ID: optional(z.string().trim().min(1, { error: 'non può essere vuota' })),
    S3_SECRET_ACCESS_KEY: optional(z.string().trim().min(1, { error: 'non può essere vuota' })),
    // Garage needs path-style requests (verified with Garage 2.5.0, ADR 021); R2 accepts both
    S3_FORCE_PATH_STYLE: withDefault(z.enum(['0', '1'], { error: 'deve essere 0 o 1' }), '1'),
    REQUIRE_2FA: withDefault(z.enum(['admins', 'all']), 'admins'),
    BOOTSTRAP_OWNER_EMAIL: optional(z.email({ error: 'deve essere un indirizzo email' })),
    BOOTSTRAP_ORGANIZATION_NAME: withDefault(
      z
        .string()
        .trim()
        .min(2, { error: 'da 2 a 80 caratteri' })
        .max(80, { error: 'da 2 a 80 caratteri' }),
      'La mia agenzia',
    ),
    SENTRY_DSN: optional(url),
    LOG_LEVEL: withDefault(z.enum(LOG_LEVELS), 'info'),
    WORKER_QUEUES: withDefault(z.string(), 'all'),
    APP_TEST_ROUTES: withDefault(z.enum(['0', '1'], { error: 'deve essere 0 o 1' }), '0'),
  })
  .check((ctx) => {
    const { NODE_ENV, PANEL_URL, PUBLIC_URL, APP_TEST_ROUTES, STORAGE_DRIVER } = ctx.value
    const { MEDIA_ROOT, MEDIA_UPLOAD_DIR } = ctx.value
    if (MEDIA_UPLOAD_DIR !== undefined && !isOutsideKeys(MEDIA_UPLOAD_DIR, MEDIA_ROOT))
      ctx.issues.push({
        code: 'custom',
        input: undefined,
        path: ['MEDIA_UPLOAD_DIR'],
        message: 'deve stare fuori da MEDIA_ROOT/org e MEDIA_ROOT/users',
      })
    if (STORAGE_DRIVER === 's3')
      for (const name of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const)
        if (ctx.value[name] === undefined)
          ctx.issues.push({
            code: 'custom',
            input: undefined,
            path: [name],
            message: 'obbligatoria con STORAGE_DRIVER=s3',
          })
    // cookies ignore the port: on the panel's host name the public host would get its cookies
    if (
      PUBLIC_URL !== undefined &&
      URL.canParse(PUBLIC_URL) &&
      URL.canParse(PANEL_URL) &&
      new URL(PUBLIC_URL).hostname === new URL(PANEL_URL).hostname
    )
      ctx.issues.push({
        code: 'custom',
        input: undefined,
        path: ['PUBLIC_URL'],
        message: 'deve avere un host diverso da PANEL_URL',
      })
    // routes that fail on purpose or expose internals: never outside the automated tests
    if (APP_TEST_ROUTES === '1' && NODE_ENV !== 'test')
      ctx.issues.push({
        code: 'custom',
        input: APP_TEST_ROUTES,
        path: ['APP_TEST_ROUTES'],
        message: 'ammessa solo con NODE_ENV=test',
      })
    if (NODE_ENV !== 'production') return
    const parsed = URL.canParse(PANEL_URL) ? new URL(PANEL_URL) : null
    if (parsed && parsed.protocol !== 'https:' && !isLocalHost(parsed)) {
      ctx.issues.push({
        code: 'custom',
        input: PANEL_URL,
        path: ['PANEL_URL'],
        message: 'in produzione deve usare https (tranne localhost)',
      })
    }
  })

const migrateSchema = z.object({
  NODE_ENV: withDefault(z.enum(['development', 'test', 'production']), 'development'),
  DATABASE_MIGRATOR_URL: z.string({ error: 'obbligatoria' }).min(1, 'obbligatoria'),
  DATABASE_RUNTIME_ROLE: withDefault(z.string().min(1), 'app_runtime'),
  LOG_LEVEL: withDefault(z.enum(LOG_LEVELS), 'info'),
})

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production'
  databaseUrl: string
  encryptionKey: Buffer
  panelUrl: URL
  publicUrl: URL | null
  /**
   * Host name of PUBLIC_URL, where only `/m/*` and `/share/*` answer (spec §16.1); null without
   * PUBLIC_URL: the public host is off. Requests are routed by entry point, never by `Host`.
   */
  publicHost: string | null
  metaGraphVersion: string
  /** Retirement date of `metaGraphVersion` (YYYY-MM-DD): the panel warns 90 days before. */
  metaGraphVersionSunset: string
  metaMode: 'live' | 'mock' | 'dry-run'
  /** Redacted Meta answers are saved here, only with metaMode `live` (Meta test, plan 03 Task 13). */
  metaRecordDir: string | null
  /** The fake Graph API (`tools/meta-mock`), only with metaMode `mock`; null otherwise. */
  metaMockUrl: string | null
  defaultTimezone: string
  mediaRetentionDays: number
  /** Folder of stored files (photos, exports): the `media` volume in the container. */
  mediaRoot: string
  media: MediaLimits
  storage: StorageConfig
  require2fa: 'admins' | 'all'
  bootstrapOwnerEmail: string | null
  /** Name of the agency created with the first account. */
  bootstrapOrganizationName: string
  sentryDsn: string | null
  logLevel: (typeof LOG_LEVELS)[number]
  workerQueues: 'all' | readonly string[]
  /** The `__test` routes of the web role (APP_TEST_ROUTES=1, only with NODE_ENV=test). */
  testRoutes: boolean
  /** Required for the web role, null for the worker. */
  betterAuth: BetterAuthSecrets | null
}

export interface MediaLimits {
  /** Chunks of uploads in progress, on the web's disk until completed (ADR 021). */
  uploadDir: string
  maxVideoBytes: number
  maxImageBytes: number
  /** Checked from the header, before decoding. */
  maxImagePixels: number
  maxVideoSeconds: number
  /** Width × height, checked from ffprobe before converting. */
  maxVideoPixels: number
  /** Space of one workspace (spec §11.1 point 6); null: no limit beyond the agency's. */
  workspaceMaxBytes: number | null
  conversionsPerOrg: number
}

export type StorageConfig =
  | { driver: 'disk' }
  | {
      driver: 's3'
      /** Unset for AWS itself; R2 and Garage need it. */
      endpoint: string | undefined
      bucket: string
      region: string
      credentials: { accessKeyId: string; secretAccessKey: string }
      forcePathStyle: boolean
    }

export type WebConfig = AppConfig & { betterAuth: BetterAuthSecrets }
export type WorkerConfig = AppConfig

export interface MigrateConfig {
  nodeEnv: 'development' | 'test' | 'production'
  migratorUrl: string
  runtimeRole: string
  logLevel: (typeof LOG_LEVELS)[number]
}

export interface ConfigByRole {
  web: WebConfig
  worker: WorkerConfig
  migrate: MigrateConfig
}

type Env = Record<string, string | undefined>

function storageOf(v: z.infer<typeof appSchema>): StorageConfig {
  const { S3_BUCKET: bucket, S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secret } = v
  // the schema check has already rejected s3 without these
  if (v.STORAGE_DRIVER === 'disk' || !bucket || !accessKeyId || !secret) return { driver: 'disk' }
  return {
    driver: 's3',
    endpoint: v.S3_ENDPOINT,
    bucket,
    region: v.S3_REGION,
    credentials: { accessKeyId, secretAccessKey: secret },
    forcePathStyle: v.S3_FORCE_PATH_STYLE === '1',
  }
}

/** Resolves `NAME` or `NAME_FILE` (trailing newline stripped); both set is an error. */
function resolveVariables(env: Env, readFile: (path: string) => string): [Raw, ConfigIssue[]] {
  const raw: Raw = {}
  const issues: ConfigIssue[] = []
  for (const name of RESOLVABLE) {
    const direct = env[name]
    const file = env[`${name}_FILE`]
    if (direct !== undefined && direct !== '' && file !== undefined && file !== '') {
      issues.push({ variable: name, problem: 'impostata sia direttamente sia come file' })
    } else if (file !== undefined && file !== '') {
      try {
        raw[name] = readFile(file).replace(/\r?\n$/, '')
      } catch {
        issues.push({ variable: `${name}_FILE`, problem: 'file non leggibile' })
      }
    } else if (direct !== undefined) {
      raw[name] = direct
    }
  }
  return [raw, issues]
}

function toIssues(error: z.ZodError): ConfigIssue[] {
  return error.issues.map((i) => ({
    variable: String(i.path[0] ?? 'ENV'),
    // only our own messages: zod's defaults can echo the received value
    problem: i.message,
  }))
}

export function loadConfig<R extends ConfigRole>(
  role: R,
  env: Env,
  readFile?: (path: string) => string,
): ConfigByRole[R]
export function loadConfig(
  role: ConfigRole,
  env: Env,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): AppConfig | MigrateConfig {
  const [raw, fileIssues] = resolveVariables(env, readFile)
  if (role === 'migrate') {
    const parsed = migrateSchema.safeParse(raw)
    if (fileIssues.length > 0 || !parsed.success) {
      throw new ConfigError([...fileIssues, ...(parsed.success ? [] : toIssues(parsed.error))])
    }
    const v = parsed.data
    return {
      nodeEnv: v.NODE_ENV,
      migratorUrl: v.DATABASE_MIGRATOR_URL,
      runtimeRole: v.DATABASE_RUNTIME_ROLE,
      logLevel: v.LOG_LEVEL,
    }
  }

  const parsed = appSchema.safeParse(raw)
  const issues = [...fileIssues, ...(parsed.success ? [] : toIssues(parsed.error))]
  let workerQueues: 'all' | readonly string[] = 'all'
  if (parsed.success && role === 'worker' && parsed.data.WORKER_QUEUES !== 'all') {
    workerQueues = parsed.data.WORKER_QUEUES.split(',').map((q) => q.trim())
    const unknown = workerQueues.filter((q) => !(KNOWN_QUEUES as readonly string[]).includes(q))
    if (unknown.length > 0) {
      issues.push({ variable: 'WORKER_QUEUES', problem: 'contiene code sconosciute' })
    }
  }
  let betterAuth: BetterAuthSecrets | null = null
  if (parsed.success) {
    const { BETTER_AUTH_SECRET: secret, BETTER_AUTH_SECRETS: versions } = parsed.data
    if (role === 'web' && secret === undefined)
      issues.push({ variable: 'BETTER_AUTH_SECRET', problem: 'obbligatoria' })
    const secrets =
      versions === undefined
        ? secret === undefined
          ? []
          : [{ version: 1, value: secret }]
        : parseSecretVersions(versions)
    if (secrets === null)
      issues.push({ variable: 'BETTER_AUTH_SECRETS', problem: BETTER_AUTH_SECRETS_FORM })
    else if (secret !== undefined) betterAuth = { secret, secrets }
  }
  let metaGraphVersionSunset = ''
  if (parsed.success) {
    const { META_GRAPH_VERSION: version, META_GRAPH_VERSION_SUNSET: sunset } = parsed.data
    const known = sunset ?? META_GRAPH_SUNSETS[version]
    if (known === undefined)
      issues.push({
        variable: 'META_GRAPH_VERSION_SUNSET',
        problem: 'obbligatoria per una versione senza data di ritiro nota',
      })
    else metaGraphVersionSunset = known
  }
  if (issues.length > 0 || !parsed.success) throw new ConfigError(issues)

  const v = parsed.data
  return {
    nodeEnv: v.NODE_ENV,
    databaseUrl: v.DATABASE_URL,
    encryptionKey: v.APP_ENCRYPTION_KEY,
    panelUrl: new URL(v.PANEL_URL),
    publicUrl: v.PUBLIC_URL ? new URL(v.PUBLIC_URL) : null,
    publicHost: v.PUBLIC_URL ? new URL(v.PUBLIC_URL).hostname : null,
    metaGraphVersion: v.META_GRAPH_VERSION,
    metaGraphVersionSunset,
    metaMode: v.META_MODE,
    metaRecordDir: v.META_RECORD_DIR ?? null,
    metaMockUrl: v.META_MODE === 'mock' ? (v.META_MOCK_URL ?? DEFAULT_META_MOCK_URL) : null,
    defaultTimezone: v.TZ_DEFAULT,
    mediaRetentionDays: v.MEDIA_RETENTION_DAYS,
    mediaRoot: v.MEDIA_ROOT,
    media: {
      uploadDir: v.MEDIA_UPLOAD_DIR ?? posix.join(v.MEDIA_ROOT, 'uploads'),
      maxVideoBytes: v.MEDIA_MAX_VIDEO_BYTES,
      maxImageBytes: v.MEDIA_MAX_IMAGE_BYTES,
      maxImagePixels: v.MEDIA_MAX_IMAGE_PIXELS,
      maxVideoSeconds: v.MEDIA_MAX_VIDEO_SECONDS,
      maxVideoPixels: v.MEDIA_MAX_VIDEO_PIXELS,
      workspaceMaxBytes: v.MEDIA_WORKSPACE_MAX_BYTES ?? null,
      conversionsPerOrg: v.MEDIA_CONVERSIONS_PER_ORG,
    },
    storage: storageOf(v),
    require2fa: v.REQUIRE_2FA,
    bootstrapOwnerEmail: v.BOOTSTRAP_OWNER_EMAIL ?? null,
    bootstrapOrganizationName: v.BOOTSTRAP_ORGANIZATION_NAME,
    sentryDsn: v.SENTRY_DSN ?? null,
    testRoutes: v.APP_TEST_ROUTES === '1',
    logLevel: v.LOG_LEVEL,
    workerQueues,
    betterAuth,
  }
}

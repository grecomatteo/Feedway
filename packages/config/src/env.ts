import { readFileSync } from 'node:fs'
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
export const KNOWN_QUEUES = ['system.selftest'] as const

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const

const RESOLVABLE = [
  'DATABASE_URL',
  'DATABASE_MIGRATOR_URL',
  'APP_ENCRYPTION_KEY',
  'PANEL_URL',
  'PUBLIC_URL',
  'META_GRAPH_VERSION',
  'META_MODE',
  'TZ_DEFAULT',
  'MEDIA_RETENTION_DAYS',
  'REQUIRE_2FA',
  'BOOTSTRAP_OWNER_EMAIL',
  'SENTRY_DSN',
  'LOG_LEVEL',
  'DATABASE_RUNTIME_ROLE',
  'WORKER_QUEUES',
  'NODE_ENV',
] as const

type Raw = Partial<Record<(typeof RESOLVABLE)[number], string>>

const isLocalHost = (url: URL) =>
  url.hostname === 'localhost' || url.hostname.endsWith('.localhost')

const url = z.url({ error: 'deve essere un indirizzo valido' })
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v)
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(emptyToUndefined, schema.optional())
const withDefault = <V extends string | number>(schema: z.ZodType<V>, value: V) =>
  z.preprocess(emptyToUndefined, schema.default(value))

const encryptionKey = z
  .string({ error: 'obbligatoria' })
  .refine((v) => /^[A-Za-z0-9+/]+={0,2}$/.test(v) && Buffer.from(v, 'base64').length === 32, {
    error: 'deve essere di 32 byte in base64',
  })
  .transform((v) => Buffer.from(v, 'base64'))

const appSchema = z
  .object({
    NODE_ENV: withDefault(z.enum(['development', 'test', 'production']), 'development'),
    DATABASE_URL: z.string({ error: 'obbligatoria' }).min(1, 'obbligatoria'),
    APP_ENCRYPTION_KEY: encryptionKey,
    PANEL_URL: z.string({ error: 'obbligatoria' }).pipe(url),
    PUBLIC_URL: optional(url),
    META_GRAPH_VERSION: withDefault(
      z.string().regex(/^v\d+\.\d+$/, { error: 'deve avere la forma v24.0' }),
      'v24.0',
    ),
    META_MODE: withDefault(z.enum(['live', 'mock', 'dry-run']), 'live'),
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
    REQUIRE_2FA: withDefault(z.enum(['admins', 'all']), 'admins'),
    BOOTSTRAP_OWNER_EMAIL: optional(z.email({ error: 'deve essere un indirizzo email' })),
    SENTRY_DSN: optional(url),
    LOG_LEVEL: withDefault(z.enum(LOG_LEVELS), 'info'),
    WORKER_QUEUES: withDefault(z.string(), 'all'),
  })
  .check((ctx) => {
    const { NODE_ENV, PANEL_URL } = ctx.value
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
  metaGraphVersion: string
  metaMode: 'live' | 'mock' | 'dry-run'
  defaultTimezone: string
  mediaRetentionDays: number
  require2fa: 'admins' | 'all'
  bootstrapOwnerEmail: string | null
  sentryDsn: string | null
  logLevel: (typeof LOG_LEVELS)[number]
  workerQueues: 'all' | readonly string[]
}

export type WebConfig = AppConfig
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
  if (issues.length > 0 || !parsed.success) throw new ConfigError(issues)

  const v = parsed.data
  return {
    nodeEnv: v.NODE_ENV,
    databaseUrl: v.DATABASE_URL,
    encryptionKey: v.APP_ENCRYPTION_KEY,
    panelUrl: new URL(v.PANEL_URL),
    publicUrl: v.PUBLIC_URL ? new URL(v.PUBLIC_URL) : null,
    metaGraphVersion: v.META_GRAPH_VERSION,
    metaMode: v.META_MODE,
    defaultTimezone: v.TZ_DEFAULT,
    mediaRetentionDays: v.MEDIA_RETENTION_DAYS,
    require2fa: v.REQUIRE_2FA,
    bootstrapOwnerEmail: v.BOOTSTRAP_OWNER_EMAIL ?? null,
    sentryDsn: v.SENTRY_DSN ?? null,
    logLevel: v.LOG_LEVEL,
    workerQueues,
  }
}

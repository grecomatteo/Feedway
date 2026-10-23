import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import {
  createBootstrapLink,
  createOrganization,
  disableUserEverywhere,
  enableUserEverywhere,
  findOrganizationBySlug,
  listOrganizations,
  platformUserIdByEmail,
  reactivateOrganization,
  setOrganizationLimits,
  suspendOrganization,
  SYSTEM_PLATFORM_ACTOR,
  type PlatformDeps,
  type PlatformOrganization,
} from '@app/application'
import { ConfigError, loadConfig, type WorkerConfig } from '@app/config'
import { DomainError, type LimitKey, type OrganizationLimits } from '@app/domain'
import {
  createDb,
  createKeyRing,
  createLogger,
  createTokenService,
  createUnitOfWork,
  systemClock,
  uuidV7Generator,
} from '@app/infrastructure'

const EXIT_FAILED = 1
const EXIT_USAGE = 64
const EXIT_SOFTWARE = 70
const EXIT_CONFIG = 78

const USAGE = [
  'Comandi:',
  '  bootstrap-link',
  '  create-organization --name "<nome>" --owner-email <email>',
  '  suspend-organization <slug>',
  '  reactivate-organization <slug>',
  '  set-limits <slug> [--workspaces N] [--social-accounts N] [--users N] [--storage-gb N] [--posts-per-day N]',
  '  set-limits <slug> --unlimited',
  '  list-organizations',
  '  disable-user <email>',
  '  enable-user <email>',
].join('\n')

export interface CliIo {
  /** The result: what a script reads. */
  out(line: string): void
  /** Messages for the person at the terminal. */
  err(line: string): void
}

class UsageError extends Error {}

const GIB = 1024 ** 3

/** CLI option → limit key; `storage-gb` is converted to bytes. */
const LIMIT_OPTIONS: Readonly<Record<string, LimitKey>> = {
  workspaces: 'workspaces',
  'social-accounts': 'social_accounts',
  users: 'users',
  'storage-gb': 'storage_bytes',
  'posts-per-day': 'posts_per_day',
}

const LIMIT_KEY_OF: ReadonlyMap<string, LimitKey> = new Map(Object.entries(LIMIT_OPTIONS))

type Command =
  | { name: 'bootstrap-link' }
  | { name: 'create-organization'; organizationName: string; ownerEmail: string }
  | { name: 'suspend-organization' | 'reactivate-organization'; slug: string }
  | { name: 'set-limits'; slug: string; limits: OrganizationLimits }
  | { name: 'list-organizations' }
  | { name: 'disable-user' | 'enable-user'; email: string }

function wholeNumber(option: string, raw: string): number {
  if (!/^\d+$/.test(raw)) throw new UsageError(`--${option} vuole un numero intero da 0 in su`)
  const value = Number(raw) * (option === 'storage-gb' ? GIB : 1)
  if (!Number.isSafeInteger(value)) throw new UsageError(`--${option}: numero troppo grande`)
  return value
}

/** Strict: an unknown option, a missing value or an extra argument is a usage error. */
function parseCommand(args: readonly string[]): Command {
  const [name, ...rest] = args
  const parse = (
    options: Record<string, { type: 'string' } | { type: 'boolean' }>,
    positionals: number,
  ) => {
    let parsed
    try {
      parsed = parseArgs({ args: rest, options, allowPositionals: true, strict: true })
    } catch (error) {
      throw new UsageError(error instanceof Error ? error.message : String(error))
    }
    if (parsed.positionals.length !== positionals)
      throw new UsageError(`'${name ?? ''}' vuole ${String(positionals)} argomenti`)
    return {
      values: parsed.values as Record<string, string | boolean | undefined>,
      positionals: parsed.positionals,
    }
  }
  const one = () => parse({}, 1).positionals[0] ?? ''
  // slugs are lowercase: a copied ' Agenzia-Rossi ' still finds the agency
  const slugOf = (raw: string) => raw.trim().toLowerCase()
  switch (name) {
    case 'bootstrap-link':
    case 'list-organizations':
      parse({}, 0)
      return { name }
    case 'create-organization': {
      const { values } = parse({ name: { type: 'string' }, 'owner-email': { type: 'string' } }, 0)
      const organizationName = values.name
      const ownerEmail = values['owner-email']
      if (typeof organizationName !== 'string' || typeof ownerEmail !== 'string')
        throw new UsageError('Servono --name e --owner-email')
      return { name, organizationName, ownerEmail }
    }
    case 'suspend-organization':
    case 'reactivate-organization':
      return { name, slug: slugOf(one()) }
    case 'set-limits': {
      const options = {
        ...Object.fromEntries(
          Object.keys(LIMIT_OPTIONS).map((o) => [o, { type: 'string' as const }]),
        ),
        unlimited: { type: 'boolean' as const },
      }
      const { values, positionals } = parse(options, 1)
      const { unlimited, ...given } = values
      // parseArgs (strict) returns only the options declared above
      const limits: OrganizationLimits = Object.fromEntries(
        Object.entries(given).flatMap(([option, raw]) => {
          const key = LIMIT_KEY_OF.get(option)
          return key === undefined || typeof raw !== 'string'
            ? []
            : [[key, wholeNumber(option, raw)]]
        }),
      )
      // an empty command must not silently lift every limit: that takes --unlimited
      if (unlimited === true && Object.keys(limits).length > 0)
        throw new UsageError('--unlimited non va insieme ad altri limiti')
      if (unlimited !== true && Object.keys(limits).length === 0)
        throw new UsageError('Indica almeno un limite, oppure --unlimited per toglierli tutti')
      return { name, slug: slugOf(positionals[0] ?? ''), limits }
    }
    case 'disable-user':
    case 'enable-user':
      return { name, email: one() }
    default:
      throw new UsageError(`Comando sconosciuto: '${name ?? ''}'.`)
  }
}

const DISABLE_MESSAGE: ReadonlyMap<string, string> = new Map([
  ['disabled', 'Account disattivato su tutte le agenzie, sessioni chiuse'],
  ['already_disabled', 'Account già disattivato: nessun cambiamento'],
  ['anonymized', 'Account anonimizzato: nessun cambiamento'],
])

const ENABLE_MESSAGE: ReadonlyMap<string, string> = new Map([
  ['enabled', 'Account riattivato: i link "Non sono stato io" precedenti non valgono più'],
  ['already_active', 'Account già attivo: nessun cambiamento'],
])

/** The SQLSTATE or system code of a failure, never its message: drizzle puts the query parameters there. */
function failureCode(error: unknown): string | null {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code)) return code
  }
  return null
}

const STATUS_LABEL = { active: 'attiva', suspended: 'sospesa' } as const

const ofLimit = (limit: number | undefined) => (limit === undefined ? 'illimitati' : String(limit))

/** One line per agency: slug, status, usage against limits. */
function describeOrganization(o: PlatformOrganization): string {
  const storage = o.limits.storage_bytes
  return [
    o.slug,
    STATUS_LABEL[o.status],
    `utenti ${String(o.usage.users)}/${ofLimit(o.limits.users)}`,
    `spazi ${String(o.usage.workspaces)}/${ofLimit(o.limits.workspaces)}`,
    `account social max ${ofLimit(o.limits.social_accounts)}`,
    `spazio su disco max ${storage === undefined ? 'illimitato' : `${String(storage / GIB)} GB`}`,
    `post al giorno max ${ofLimit(o.limits.posts_per_day)}`,
  ].join('\t')
}

async function execute(
  command: Command,
  config: WorkerConfig,
  deps: PlatformDeps,
  io: CliIo,
): Promise<void> {
  const system = SYSTEM_PLATFORM_ACTOR
  switch (command.name) {
    case 'bootstrap-link': {
      const { url } = await createBootstrapLink({
        ...deps,
        config: {
          bootstrapOwnerEmail: config.bootstrapOwnerEmail,
          bootstrapOrganizationName: config.bootstrapOrganizationName,
          require2fa: config.require2fa,
          panelUrl: config.panelUrl.toString(),
        },
      })
      io.out(url)
      return
    }
    case 'create-organization': {
      const r = await createOrganization(deps, system, {
        name: command.organizationName,
        ownerEmail: command.ownerEmail,
      })
      io.out(r.slug)
      if (r.ownerActivationUrl === null)
        io.err('L’Owner ha già un account: trova l’agenzia nel selettore delle agenzie.')
      else {
        io.out(r.ownerActivationUrl)
        io.err('Manda il link all’Owner: vale un’ora.')
      }
      return
    }
    case 'suspend-organization':
    case 'reactivate-organization': {
      const { id, slug } = await findOrganizationBySlug(deps, system, command.slug)
      const suspend = command.name === 'suspend-organization'
      await (suspend ? suspendOrganization : reactivateOrganization)(deps, system, id)
      io.out(`Agenzia ${slug} ${suspend ? 'sospesa' : 'riattivata'}`)
      return
    }
    case 'set-limits': {
      const { id } = await findOrganizationBySlug(deps, system, command.slug)
      await setOrganizationLimits(deps, system, id, command.limits)
      io.out(describeOrganization(await findOrganizationBySlug(deps, system, command.slug)))
      return
    }
    case 'list-organizations':
      for (const o of await listOrganizations(deps, system)) io.out(describeOrganization(o))
      return
    case 'disable-user':
    case 'enable-user': {
      const userId = await platformUserIdByEmail(deps, system, command.email)
      const disable = command.name === 'disable-user'
      if (disable) {
        const result = await disableUserEverywhere(deps, system, userId)
        io.out(DISABLE_MESSAGE.get(result) ?? result)
        return
      }
      const { status, passwordResetUrl } = await enableUserEverywhere(deps, system, userId)
      io.out(ENABLE_MESSAGE.get(status) ?? status)
      if (passwordResetUrl !== null) {
        io.out(passwordResetUrl)
        io.err(
          'L’account era stato bloccato con "Non sono stato io": la vecchia password non vale ' +
            'più. Manda alla persona questo link per sceglierne una nuova: vale un’ora.',
        )
      }
      return
    }
  }
}

/** Platform commands run in the image: `docker compose run --rm worker cli <command>`. */
export async function runCli(
  args: readonly string[],
  env: Record<string, string | undefined>,
  io: CliIo,
): Promise<number> {
  let command: Command
  try {
    command = parseCommand(args)
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    io.err(`${error.message}\n${USAGE}`)
    return EXIT_USAGE
  }

  let config
  try {
    config = loadConfig('worker', env)
  } catch (error) {
    if (error instanceof ConfigError) {
      io.err(error.message)
      return EXIT_CONFIG
    }
    throw error
  }

  // warnings only, on stderr: stdout carries the results and nothing else
  const logger = createLogger({ service: 'cli', level: 'warn', destination: process.stderr })
  const handle = createDb(config.databaseUrl, { max: 1, applicationName: 'cli' })
  try {
    await execute(
      command,
      config,
      {
        uow: createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger }),
        clock: systemClock,
        ids: uuidV7Generator,
        tokens: createTokenService(),
        keyRing: createKeyRing({ platformKey: config.encryptionKey, clock: systemClock }),
        config: { panelUrl: config.panelUrl.toString() },
      },
      io,
    )
    return 0
  } catch (error) {
    if (error instanceof DomainError) {
      io.err(error.message)
      return EXIT_FAILED
    }
    // not the person's mistake (database down, migrations missing): its own code for scripts.
    // Only the error code: the message of a failed query carries its parameters (emails,
    // token hashes, sealed keys), and the logger does not know how to redact those.
    const code = failureCode(error)
    io.err(
      `Operazione non riuscita${code === null ? '' : ` (codice ${code})`}: controlla che il ` +
        'database sia raggiungibile e aggiornato, poi riprova.',
    )
    return EXIT_SOFTWARE
  } finally {
    await handle.close()
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2), process.env, {
    out: (line) => {
      process.stdout.write(`${line}\n`)
    },
    err: (line) => {
      process.stderr.write(`${line}\n`)
    },
  })
}

import { pathToFileURL } from 'node:url'
import { createBootstrapLink } from '@app/application'
import { ConfigError, loadConfig } from '@app/config'
import { DomainError } from '@app/domain'
import {
  createDb,
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

const USAGE = 'Comandi: bootstrap-link'

export interface CliIo {
  /** The result, one line: what a script reads. */
  out(line: string): void
  /** Messages for the person at the terminal. */
  err(line: string): void
}

/** Platform commands run in the image: `docker compose run --rm worker cli <command>`. */
export async function runCli(
  args: readonly string[],
  env: Record<string, string | undefined>,
  io: CliIo,
): Promise<number> {
  const [command] = args
  if (command !== 'bootstrap-link') {
    io.err(`Comando sconosciuto: '${command ?? ''}'. ${USAGE}`)
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

  // warnings only, on stderr: stdout carries the link and nothing else
  const logger = createLogger({ service: 'cli', level: 'warn', destination: process.stderr })
  const handle = createDb(config.databaseUrl, { max: 1, applicationName: 'cli' })
  try {
    const { url } = await createBootstrapLink({
      uow: createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger }),
      clock: systemClock,
      ids: uuidV7Generator,
      tokens: createTokenService(),
      config: {
        bootstrapOwnerEmail: config.bootstrapOwnerEmail,
        bootstrapOrganizationName: config.bootstrapOrganizationName,
        require2fa: config.require2fa,
        panelUrl: config.panelUrl.toString(),
      },
    })
    io.out(url)
    return 0
  } catch (error) {
    if (error instanceof DomainError) {
      io.err(error.message)
      return EXIT_FAILED
    }
    // not the person's mistake (database down, migrations missing): its own code for scripts
    io.err(`Operazione non riuscita: ${error instanceof Error ? error.message : String(error)}`)
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

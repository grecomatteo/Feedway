import { ConfigError, loadConfig } from '@app/config'
import { createLogger, runMigrations } from '@app/infrastructure'

const EXIT_CONFIG = 78

async function main(): Promise<void> {
  let config
  try {
    config = loadConfig('migrate', process.env)
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message)
      process.exit(EXIT_CONFIG)
    }
    throw error
  }

  const logger = createLogger({ service: 'migrate', level: config.logLevel })
  await runMigrations({
    migratorUrl: config.migratorUrl,
    runtimeRole: config.runtimeRole,
    logger,
  })
  logger.info({}, 'migrations done')
}

await main()

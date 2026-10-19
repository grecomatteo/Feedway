import type { Logger, LogLevel } from '@app/application'
import pino from 'pino'
import { scrubSecrets } from './scrub.js'

const SECRET_KEYS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'access_token',
  'secret',
  'appSecret',
  'apiKey',
  'authorization',
  'cookie',
  'set-cookie',
  'totpSecret',
  'encryptionKey',
]

// fast-redact wildcards match one level each, so cover top level and two nested levels
const REDACT_PATHS = SECRET_KEYS.flatMap((key) => {
  const k = /^[A-Za-z_]\w*$/.test(key) ? key : `["${key}"]`
  return [k, `*.${k}`, `*.*.${k}`]
})

export interface LoggerOptions {
  service: 'web' | 'worker' | 'migrate' | 'cli'
  level: LogLevel
  destination?: NodeJS.WritableStream
}

function serializeError(err: unknown): unknown {
  if (!(err instanceof Error)) return err
  // only known-safe fields: driver errors carry the whole client (connection parameters included)
  const code = (err as { code?: unknown }).code
  return {
    type: err.name,
    message: scrubSecrets(err.message),
    ...(err.stack !== undefined && { stack: scrubSecrets(err.stack) }),
    ...(typeof code === 'string' && { code }),
  }
}

export function createLogger(opts: LoggerOptions): Logger {
  const root = pino(
    {
      level: opts.level,
      base: { service: opts.service },
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      serializers: {
        err: serializeError,
        url: (v: unknown) => (typeof v === 'string' ? scrubSecrets(v) : v),
        path: (v: unknown) => (typeof v === 'string' ? scrubSecrets(v) : v),
      },
      hooks: {
        logMethod(args, method) {
          const [first, second] = args
          if (typeof first === 'string') {
            args[0] = scrubSecrets(first)
          } else if (typeof second === 'string') {
            args[1] = scrubSecrets(second)
          } else if (first instanceof Error) {
            // pino would copy the raw error message into msg
            args[1] = scrubSecrets(first.message)
          } else if (typeof first === 'object' && first !== null && 'err' in first) {
            const err = first.err
            if (err instanceof Error) args[1] = scrubSecrets(err.message)
          }
          method.apply(this, args)
        },
      },
    },
    opts.destination,
  )
  return adapt(root)
}

function adapt(logger: pino.Logger): Logger {
  return {
    debug: (obj, msg) => {
      logger.debug(obj, msg)
    },
    info: (obj, msg) => {
      logger.info(obj, msg)
    },
    warn: (obj, msg) => {
      logger.warn(obj, msg)
    },
    error: (obj, msg) => {
      logger.error(obj, msg)
    },
    child: (bindings) => adapt(logger.child(bindings)),
  }
}

import type { Logger } from '@app/application'

type LibraryLevel = 'debug' | 'info' | 'success' | 'warn' | 'error'

/**
 * Better Auth's own messages, through our logger (which scrubs them) instead of the console:
 * there a failed query would print its parameters, a reset token or an email among them.
 */
export function libraryLog(logger: Logger) {
  return (level: LibraryLevel, message: string, ...args: unknown[]): void => {
    const err = args.find((a): a is Error => a instanceof Error)
    const entry = err ? { err } : {}
    const text = `better-auth: ${message}`
    if (level === 'error') logger.error(entry, text)
    else if (level === 'warn') logger.warn(entry, text)
    else if (level === 'debug') logger.debug(entry, text)
    else logger.info(entry, text)
  }
}

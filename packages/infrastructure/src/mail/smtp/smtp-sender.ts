import type { MailMessage, SmtpConfig } from '@app/application'
import { createTransport } from 'nodemailer'
import { normalizeHostName, resolveDestination, systemResolve } from './destination.js'
import type { Destination, Resolve } from './destination.js'
import { isMailAddress, parseSmtpConfig } from './smtp-config.js'
import { safeResponse, SmtpSendError } from './smtp-error.js'
import type { SmtpFailureKind } from './smtp-error.js'

export interface SmtpTimeouts {
  dnsMs: number
  /** Until the TCP (and, on 465, TLS) connection is open. */
  connectionMs: number
  /** Until the server's greeting. */
  greetingMs: number
  /** Silence allowed on an open connection. */
  socketMs: number
}

const DEFAULT_TIMEOUTS: SmtpTimeouts = {
  dnsMs: 5_000,
  connectionMs: 10_000,
  greetingMs: 10_000,
  socketMs: 30_000,
}

/**
 * Only the tests build this: it is never read from the environment or the configuration, so no
 * setting can reach it in production.
 */
export interface SmtpTestingOptions {
  /** Resolves names in place of the system DNS (to prove the address checks). */
  resolve?: Resolve
  /**
   * Connects to this fake server on 127.0.0.1 instead of the configured host and port, past the
   * address checks, trusting only `ca`. The certificate must still match the configured host.
   */
  fakeServer?: { port: number; ca: string }
  timeouts?: Partial<SmtpTimeouts>
}

export interface SmtpSender {
  /** Sends one message over a fresh TLS connection, closed afterwards. Throws `SmtpSendError`. */
  send(config: SmtpConfig, secret: string, message: MailMessage): Promise<void>
}

const TLS_ERROR =
  /certificate|self[- ]signed|unable to verify|hostname\/ip does not match|altnames|ssl|tls|wrong version/i

function classify(error: unknown): SmtpFailureKind {
  const e = error as { code?: unknown; responseCode?: unknown; message?: unknown }
  const message = typeof e.message === 'string' ? e.message : ''
  switch (e.code) {
    case 'EAUTH':
    case 'ENOAUTH':
      return 'auth'
    case 'ETIMEDOUT':
      return 'timeout'
    case 'ETLS':
      return 'tls'
    case 'EDNS':
      return 'dns'
    case 'EENVELOPE':
    case 'EMESSAGE':
      return 'rejected'
    default:
      if (TLS_ERROR.test(message)) return 'tls'
      return typeof e.responseCode === 'number' && e.responseCode >= 500 ? 'rejected' : 'connection'
  }
}

/** What the server said, if it said anything, without our credentials. */
function serverReply(error: unknown, secrets: readonly string[]): string | undefined {
  const response = (error as { response?: unknown }).response
  return typeof response === 'string' && response.length > 0
    ? safeResponse(response, secrets)
    : undefined
}

export function createSmtpSender(opts: { testing?: SmtpTestingOptions } = {}): SmtpSender {
  const timeouts = { ...DEFAULT_TIMEOUTS, ...opts.testing?.timeouts }
  const resolve = opts.testing?.resolve ?? systemResolve
  const fake = opts.testing?.fakeServer

  async function destination(config: SmtpConfig): Promise<Destination & { port: number }> {
    if (fake) {
      // only the address and the port are replaced: the certificate still names the host
      const servername = normalizeHostName(config.host)
      if (servername === null) throw new SmtpSendError('invalid_config')
      return { address: '127.0.0.1', servername, port: fake.port }
    }
    const found = await resolveDestination(config.host, { resolve, timeoutMs: timeouts.dnsMs })
    return { ...found, port: config.port }
  }

  return {
    async send(rawConfig, secret, message) {
      // stored settings are checked again: the database is not trusted to hold valid ones
      const config = parseSmtpConfig(rawConfig)
      if (config === null || !isMailAddress(message.to) || /[\r\n]/.test(message.subject))
        throw new SmtpSendError('invalid_config')
      const target = await destination(config)
      const secrets = [secret, config.username]
      const transport = createTransport({
        // the verified address: no second DNS lookup can change where we connect
        host: target.address,
        port: target.port,
        servername: target.servername,
        secure: config.security === 'tls',
        // STARTTLS or nothing: never a session in clear text
        requireTLS: config.security === 'starttls',
        ignoreTLS: false,
        opportunisticTLS: false,
        auth: { user: config.username, pass: secret },
        tls: {
          servername: target.servername,
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2',
          ...(fake && { ca: fake.ca }),
        },
        connectionTimeout: timeouts.connectionMs,
        greetingTimeout: timeouts.greetingMs,
        socketTimeout: timeouts.socketMs,
        dnsTimeout: timeouts.dnsMs,
        // its own logs would carry the AUTH exchange
        logger: false,
        debug: false,
        transactionLog: false,
        disableFileAccess: true,
        disableUrlAccess: true,
      })
      try {
        await transport.sendMail({
          from: config.from,
          to: message.to,
          envelope: { from: config.from, to: [message.to] },
          subject: message.subject,
          text: message.text,
          html: message.html,
          disableFileAccess: true,
          disableUrlAccess: true,
        })
      } catch (error) {
        throw new SmtpSendError(classify(error), serverReply(error, secrets))
      } finally {
        transport.close()
      }
    },
  }
}

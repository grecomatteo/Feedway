import type { MailMessage, SmtpConfig } from '@app/application'
import { PRODUCT_NAME } from '@app/config'
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
  /** The whole send, however the server drips its answers. */
  totalMs: number
}

const DEFAULT_TIMEOUTS: SmtpTimeouts = {
  dnsMs: 5_000,
  connectionMs: 10_000,
  greetingMs: 10_000,
  socketMs: 30_000,
  totalMs: 60_000,
}

/** What we say in EHLO when no panel host is known: never the machine's own name. */
export const DEFAULT_CLIENT_NAME = 'feedway.invalid'

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
function serverReply(
  error: unknown,
  credentials: { username: string; secret: string },
): string | undefined {
  const response = (error as { response?: unknown }).response
  return typeof response === 'string' && response.length > 0
    ? safeResponse(response, credentials)
    : undefined
}

export interface SmtpSenderOptions {
  /** The host name given in EHLO (the panel's); `feedway.invalid` when missing or unusable. */
  clientName?: string
  testing?: SmtpTestingOptions
}

export function createSmtpSender(opts: SmtpSenderOptions = {}): SmtpSender {
  const timeouts = { ...DEFAULT_TIMEOUTS, ...opts.testing?.timeouts }
  const clientName =
    (opts.clientName === undefined ? null : normalizeHostName(opts.clientName)) ??
    DEFAULT_CLIENT_NAME
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
      if (
        config === null ||
        !isMailAddress(message.to) ||
        /[\r\n]/.test(message.subject) ||
        (message.replyTo !== undefined && !isMailAddress(message.replyTo))
      )
        throw new SmtpSendError('invalid_config')
      // every email leaves in the product's name (ADR 017); structured, so nodemailer quotes
      // and encodes the name and nothing is concatenated by hand
      const from = { name: PRODUCT_NAME, address: config.from }
      const target = await destination(config)
      const credentials = { username: config.username, secret }
      const transport = createTransport({
        // the verified address: no second DNS lookup can change where we connect
        host: target.address,
        port: target.port,
        servername: target.servername,
        // not os.hostname(): the machine's name stays private
        name: clientName,
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
      let deadline: NodeJS.Timeout | undefined
      const expired = new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          // a server that answers one byte at a time never trips the socket timeout
          transport.close()
          reject(new SmtpSendError('timeout'))
        }, timeouts.totalMs)
      })
      try {
        await Promise.race([
          transport.sendMail({
            from,
            to: message.to,
            ...(message.replyTo !== undefined && { replyTo: message.replyTo }),
            envelope: { from: config.from, to: [message.to] },
            subject: message.subject,
            text: message.text,
            html: message.html,
            disableFileAccess: true,
            disableUrlAccess: true,
          }),
          expired,
        ])
      } catch (error) {
        if (error instanceof SmtpSendError) throw error
        throw new SmtpSendError(classify(error), serverReply(error, credentials))
      } finally {
        clearTimeout(deadline)
        transport.close()
      }
    },
  }
}

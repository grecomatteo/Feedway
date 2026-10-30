import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import type { AddressInfo, Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SMTPServer } from 'smtp-server'

export interface FakeSmtpMessage {
  user: string
  from: string
  to: string[]
  data: string
}

export interface FakeSmtp {
  /** STARTTLS port on 127.0.0.1. */
  port: number
  /** The self-signed certificate the client must trust (`testing.fakeServer.ca`). */
  ca: string
  received: FakeSmtpMessage[]
  stop(): Promise<void>
}

/**
 * A STARTTLS SMTP server on 127.0.0.1 for the tests, with a certificate made for this run for
 * `names`. Accepts `password` only: any other is refused with 535. Never a real server.
 */
export async function startFakeSmtp(opts: {
  names: readonly string[]
  password: string
}): Promise<FakeSmtp> {
  const dir = await mkdtemp(join(tmpdir(), 'fake-smtp-'))
  const keyPath = join(dir, 'server.key')
  const certPath = join(dir, 'server.crt')
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-days',
      '1',
      '-subj',
      `/CN=${opts.names[0] ?? 'localhost'}`,
      '-addext',
      `subjectAltName=${opts.names.map((n) => `DNS:${n}`).join(',')}`,
      '-keyout',
      keyPath,
      '-out',
      certPath,
    ],
    { stdio: 'ignore' },
  )
  const key = await readFile(keyPath, 'utf8')
  const cert = await readFile(certPath, 'utf8')
  await rm(dir, { recursive: true, force: true })

  const received: FakeSmtpMessage[] = []
  const server = new SMTPServer({
    key,
    cert,
    secure: false,
    logger: false,
    authMethods: ['PLAIN', 'LOGIN'],
    onAuth(auth, _session, cb) {
      if (auth.password === opts.password) cb(null, { user: auth.username })
      else cb(new Error('535 Authentication credentials invalid'))
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = []
      stream.on('data', (c: Buffer) => chunks.push(c))
      stream.on('end', () => {
        received.push({
          user: String(session.user),
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((r) => r.address),
          data: Buffer.concat(chunks).toString('utf8'),
        })
        cb()
      })
    },
  })
  server.on('error', () => undefined)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const net = (server as unknown as { server: Server }).server
  return {
    port: (net.address() as AddressInfo).port,
    ca: cert,
    received,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      }),
  }
}

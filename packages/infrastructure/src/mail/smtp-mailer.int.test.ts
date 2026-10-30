import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import type { AddressInfo, Server, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { SMTPServer } from 'smtp-server'
import type { SMTPServerOptions } from 'smtp-server'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { MailMessage, MailSettingsSource, SmtpConfig } from '@app/application'
import { createMailSettings } from '@app/application'
import { createKeyRing } from '../crypto/key-ring.js'
import { createDb } from '../db/client.js'
import type { DbHandle } from '../db/client.js'
import { createIntegrationStore } from '../db/integrations/integration-store.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createLogger } from '../logging/logger.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { fixedClock, startTestDatabase } from '../testing/index.js'
import type { TestDatabase } from '../testing/index.js'
import { createSmtpMailer } from './smtp-mailer.js'
import { createSmtpSender } from './smtp/smtp-sender.js'
import type { SmtpTestingOptions } from './smtp/smtp-sender.js'

// Only fake servers on 127.0.0.1: no real mail server is ever contacted.
const NAMES = ['smtp.feedway.test', 'piattaforma.feedway.test']
const USER = 'invii@feedway.test'
const PASSWORD = 'parola-di-prova-giusta'
const WRONG_PASSWORD = 'parola-di-prova-sbagliata'

interface Received {
  /** The name the client gave in EHLO. */
  clientName: string
  user: string
  from: string
  to: string[]
  data: string
}

let dir: string
let trusted: { key: string; cert: string }
let untrusted: { key: string; cert: string }
const servers: { close(cb: () => void): void }[] = []
const received: Received[] = []
const logLines: string[] = []

/** A self-signed certificate for the test names, made for this run (openssl). */
async function selfSigned(name: string): Promise<{ key: string; cert: string }> {
  const keyPath = join(dir, `${name}.key`)
  const certPath = join(dir, `${name}.crt`)
  const san = NAMES.map((n) => `DNS:${n}`).join(',')
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
      `/CN=${name}`,
      '-addext',
      `subjectAltName=${san}`,
      '-keyout',
      keyPath,
      '-out',
      certPath,
    ],
    { stdio: 'ignore' },
  )
  return { key: await readFile(keyPath, 'utf8'), cert: await readFile(certPath, 'utf8') }
}

interface Listening {
  listen(port: number, host: string, cb: () => void): unknown
  close(cb: () => void): void
}

/** Listens on a random port of 127.0.0.1; `raw` is the net.Server when it is not `server.server`. */
async function listen(server: Listening, raw?: Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  servers.push(server)
  const net = raw ?? (server as unknown as { server: Server }).server
  return (net.address() as AddressInfo).port
}

function fakeSmtp(opts: SMTPServerOptions & { pair?: { key: string; cert: string } }) {
  const { pair = trusted, ...rest } = opts
  const server = new SMTPServer({
    key: pair.key,
    cert: pair.cert,
    logger: false,
    authMethods: ['PLAIN', 'LOGIN'],
    onAuth(auth, _session, cb) {
      if (auth.password === PASSWORD) cb(null, { user: auth.username })
      else cb(new Error('535 Authentication credentials invalid'))
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = []
      stream.on('data', (c: Buffer) => chunks.push(c))
      stream.on('end', () => {
        received.push({
          clientName: session.hostNameAppearsAs,
          user: String(session.user),
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((r) => r.address),
          data: Buffer.concat(chunks).toString('utf8'),
        })
        cb()
      })
    },
    ...rest,
  })
  // a client that refuses the certificate drops the connection: expected here
  server.on('error', () => undefined)
  return server
}

let tlsPort: number
let starttlsPort: number
let noStarttlsPort: number
let untrustedPort: number
let silentPort: number
let drippingPort: number
const openSockets: Socket[] = []

const logger = createLogger({
  service: 'worker',
  level: 'debug',
  destination: new Writable({
    write(chunk: Buffer, _enc, cb) {
      logLines.push(chunk.toString('utf8'))
      cb()
    },
  }),
})

const config = (over: Partial<SmtpConfig> = {}): SmtpConfig => ({
  host: 'smtp.feedway.test',
  port: 587,
  security: 'starttls',
  username: USER,
  from: 'avvisi@feedway.test',
  ...over,
})
const message: MailMessage = {
  to: 'persona@esempio.test',
  subject: 'Prova di invio',
  text: 'Ciao',
  html: '<p>Ciao</p>',
}

/** One fixed platform setting, for the tests that need no database. */
const fixed = (c: SmtpConfig, secret = PASSWORD): MailSettingsSource => ({
  isConfigured: () => Promise.resolve(true),
  credentials: () => Promise.resolve({ kind: 'smtp', config: c, secret }),
})

function mailerFor(
  c: SmtpConfig,
  testing: SmtpTestingOptions,
  secret = PASSWORD,
  clientName?: string,
) {
  return createSmtpMailer({
    settings: fixed(c, secret),
    smtp: createSmtpSender({ testing, ...(clientName !== undefined && { clientName }) }),
    logger,
  })
}
const fake = (port: number) => ({ fakeServer: { port, ca: trusted.cert } })

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'smtp-test-'))
  trusted = await selfSigned('trusted')
  untrusted = await selfSigned('untrusted')
  tlsPort = await listen(fakeSmtp({ secure: true }))
  starttlsPort = await listen(fakeSmtp({ secure: false }))
  noStarttlsPort = await listen(
    fakeSmtp({ secure: false, disabledCommands: ['STARTTLS'], allowInsecureAuth: true }),
  )
  untrustedPort = await listen(fakeSmtp({ secure: true, pair: untrusted }))
  // accepts the connection and never says a word
  const silent = createServer((socket) => openSockets.push(socket))
  silentPort = await listen(silent, silent)
  // greets, then answers EHLO one byte at a time, forever: no socket timeout ever trips
  const dripping = createServer((socket) => {
    openSockets.push(socket)
    socket.on('error', () => undefined)
    socket.write('220 lento.feedway.test ESMTP\r\n')
    socket.once('data', () => {
      const line = '250-RALLENTA\r\n'
      let i = 0
      const timer = setInterval(() => {
        if (socket.destroyed) clearInterval(timer)
        else socket.write(line.charAt(i++ % line.length))
      }, 20)
      socket.on('close', () => {
        clearInterval(timer)
      })
    })
  })
  drippingPort = await listen(dripping, dripping)
}, 60_000)
afterAll(async () => {
  for (const s of openSockets) s.destroy()
  await Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => {
            resolve()
          })
        }),
    ),
  )
  await rm(dir, { recursive: true, force: true })
})

test('a message leaves over implicit TLS (465) with the configured sender', async () => {
  const before = received.length
  const mailer = mailerFor(config({ port: 465, security: 'tls' }), fake(tlsPort))
  expect(await mailer.send(message)).toBe('sent')
  const got = received.slice(before)
  expect(got).toHaveLength(1)
  expect(got[0]).toMatchObject({ user: USER, from: 'avvisi@feedway.test', to: [message.to] })
  expect(got[0]?.data).toMatch(/^Subject: Prova di invio$/m)
  // always in the product's name, with the platform's address
  expect(got[0]?.data).toMatch(/^From: Feedway <avvisi@feedway\.test>$/m)
  expect(got[0]?.data).not.toMatch(/^Reply-To:/m)
  // never the machine's own name in EHLO
  expect(got[0]?.clientName).toBe('feedway.invalid')
})

test('a message leaves over STARTTLS (587)', async () => {
  const before = received.length
  const mailer = mailerFor(config(), fake(starttlsPort))
  expect(await mailer.send(message)).toBe('sent')
  expect(received.slice(before)).toHaveLength(1)
})

test('wrong credentials: an auth failure, without the password', async () => {
  const mailer = mailerFor(config(), fake(starttlsPort), WRONG_PASSWORD)
  const error = await mailer.send(message).catch((e: unknown) => e)
  expect(error).toMatchObject({ name: 'SmtpSendError', kind: 'auth' })
  expect(JSON.stringify(error) + String(error)).not.toContain(WRONG_PASSWORD)
})

test('a server that never answers: a timeout, quickly', async () => {
  const mailer = mailerFor(config(), {
    ...fake(silentPort),
    timeouts: { connectionMs: 500, greetingMs: 300, socketMs: 500 },
  })
  const started = Date.now()
  await expect(mailer.send(message)).rejects.toMatchObject({ kind: 'timeout' })
  expect(Date.now() - started).toBeLessThan(5_000)
})

test('no STARTTLS on 587: nothing is sent in clear text', async () => {
  const before = received.length
  const mailer = mailerFor(config(), fake(noStarttlsPort))
  await expect(mailer.send(message)).rejects.toMatchObject({ kind: 'tls' })
  expect(received.length).toBe(before)
})

test('a certificate we do not trust, or for another name, is refused', async () => {
  const before = received.length
  const untrustedMailer = mailerFor(config({ port: 465, security: 'tls' }), fake(untrustedPort))
  await expect(untrustedMailer.send(message)).rejects.toMatchObject({
    kind: 'tls',
  })
  const otherName = mailerFor(
    config({ host: 'altro.feedway.test', port: 465, security: 'tls' }),
    fake(tlsPort),
  )
  await expect(otherName.send(message)).rejects.toMatchObject({ kind: 'tls' })
  expect(received.length).toBe(before)
})

test.each([
  ['127.0.0.1', ['127.0.0.1']],
  ['10.x', ['10.20.30.40']],
  ['::1', ['::1']],
  ['a private address among public ones', ['93.184.215.14', '192.168.1.20']],
])('a host that resolves to %s is refused before any connection', async (_, addresses) => {
  const before = received.length
  const mailer = mailerFor(config(), { resolve: () => Promise.resolve(addresses) })
  await expect(mailer.send(message)).rejects.toMatchObject({
    kind: 'blocked_destination',
  })
  expect(received.length).toBe(before)
})

test('a recipient or a subject that could add headers is refused', async () => {
  const mailer = mailerFor(config(), fake(starttlsPort))
  for (const bad of [
    { ...message, to: 'a@b.test, c@d.test' },
    { ...message, to: 'a@b.test\r\nBcc: c@d.test' },
    { ...message, subject: 'Ciao\r\nBcc: c@d.test' },
  ])
    await expect(mailer.send(bad)).rejects.toMatchObject({
      kind: 'invalid_config',
    })
})

test('the secret never reaches the logs', () => {
  const all = logLines.join('\n')
  expect(all).toContain('email sent')
  expect(all).toContain('email not sent')
  for (const secret of [PASSWORD, WRONG_PASSWORD]) expect(all).not.toContain(secret)
  expect(all).not.toContain(Buffer.from(`\u0000${USER}\u0000${PASSWORD}`).toString('base64'))
})

test('the EHLO name is the panel host when given', async () => {
  const before = received.length
  const mailer = mailerFor(config(), fake(starttlsPort), PASSWORD, 'Pannello.Feedway.test')
  await mailer.send(message)
  expect(received.slice(before).map((r) => r.clientName)).toEqual(['pannello.feedway.test'])
  // an unusable name falls back, it never reaches the server as typed
  const odd = mailerFor(config(), fake(starttlsPort), PASSWORD, 'x\r\nMAIL FROM:<a@b.test>')
  await odd.send(message)
  expect(received.at(-1)?.clientName).toBe('feedway.invalid')
})

test('a server that drips its answers is cut off by the overall deadline', async () => {
  const mailer = mailerFor(config(), {
    ...fake(drippingPort),
    timeouts: { connectionMs: 5_000, greetingMs: 5_000, socketMs: 5_000, totalMs: 800 },
  })
  const started = Date.now()
  await expect(mailer.send(message)).rejects.toMatchObject({ kind: 'timeout' })
  expect(Date.now() - started).toBeLessThan(3_000)
})

test('Reply-To carries the given plain address', async () => {
  const before = received.length
  const mailer = mailerFor(config(), fake(starttlsPort))
  await mailer.send({ ...message, replyTo: 'chi-invita@agenzia.test' })
  const data = received.slice(before)[0]?.data ?? ''
  expect(data).toMatch(/^Reply-To: chi-invita@agenzia\.test$/m)
  expect(data).toMatch(/^From: Feedway <avvisi@feedway\.test>$/m)
  // the envelope sender stays the platform's
  expect(received.at(-1)?.from).toBe('avvisi@feedway.test')
})

test.each([
  'chi@agenzia.test\r\nBcc: altro@esempio.test',
  'uno@agenzia.test, due@agenzia.test',
  '"Nome" <chi@agenzia.test>',
  'chi@agenzia.test>',
  '',
])(
  'a Reply-To that is not a plain address (%j) is dropped, the email still goes',
  async (replyTo) => {
    const before = received.length
    const mailer = mailerFor(config(), fake(starttlsPort))
    await mailer.send({ ...message, replyTo })
    const sent = received.slice(before)
    expect(sent).toHaveLength(1)
    const data = sent[0]?.data ?? ''
    expect(data).not.toMatch(/^Reply-To:/im)
    expect(data).not.toMatch(/^Bcc:/im)
    expect(sent[0]?.to).toEqual([message.to])
  },
)

describe('with the settings in the database', () => {
  let tdb: TestDatabase
  let handle: DbHandle

  beforeAll(async () => {
    tdb = await startTestDatabase()
    handle = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'test' })
  }, 120_000)
  afterAll(async () => {
    await handle.close()
    await tdb.stop()
  })

  test('the mailer reads the platform SMTP at every send', async () => {
    const keyRing = createKeyRing({ platformKey: randomBytes(32), clock: fixedClock(new Date()) })
    const uow = createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger })
    const integrations = createIntegrationStore({ keyRing })
    const mailer = createSmtpMailer({
      settings: createMailSettings({ uow, integrations }),
      smtp: createSmtpSender({ testing: fake(starttlsPort) }),
      logger,
    })
    expect(await mailer.isConfigured()).toBe(false)
    expect(await mailer.send(message)).toBe('not_configured')

    const replace = (username: string) =>
      uow.runAsSystem('test', (tx) =>
        integrations.replacePlatform(tx, 'smtp', {
          config: config({ host: 'piattaforma.feedway.test', username }),
          secret: PASSWORD,
          updatedBy: null,
        }),
      )
    await replace('primo@feedway.test')
    expect(await mailer.isConfigured()).toBe(true)
    const before = received.length
    await mailer.send(message)
    // a change applies to the next email, with no restart
    await replace('secondo@feedway.test')
    await mailer.send(message)
    expect(received.slice(before).map((r) => r.user)).toEqual([
      'primo@feedway.test',
      'secondo@feedway.test',
    ])
    expect(logLines.join('\n')).not.toContain(PASSWORD)
  })
})

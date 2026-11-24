import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import {
  createTelegramChannel,
  createTelegramTargets,
  listTelegramLinks,
  pollTelegram,
  startTelegramLink,
  unlinkTelegram,
  type ChannelRecipient,
  type TelegramLinkDeps,
  type TelegramPollDeps,
  type Translate,
} from '@app/application'
import { TELEGRAM_MOCK, startTelegramMock, type TelegramMock } from '@app/telegram-mock'
import { createKeyRing } from '../crypto/key-ring.js'
import { createTokenService } from '../crypto/tokens.js'
import { createAdvisoryLock } from '../db/advisory-lock.js'
import { createDb } from '../db/client.js'
import type { DbHandle } from '../db/client.js'
import { createIntegrationStore } from '../db/integrations/integration-store.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createLogger } from '../logging/logger.js'
import { systemClock } from '../system/clock.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { seed, startTestDatabase } from '../testing/index.js'
import type { TestDatabase } from '../testing/index.js'
import { createTelegramBotApi } from './telegram-bot-api.js'

// Telegram's linking, commands and channel (plan 08 Task 7), against the fake Bot API only.
// Pia works in two agencies: Alfa has a bot of its own, Beta uses the platform's. Quinto works
// only in Beta, on one client: the commands tell him of that one, never of the others.

let tdb: TestDatabase
let handle: DbHandle
let admin: pg.Client
let mock: TelegramMock
let poll: TelegramPollDeps
let links: TelegramLinkDeps
let alfa: string, beta: string, pia: string, quinto: string, clientA: string, clientB: string
let clientQ: string

const PLATFORM = TELEGRAM_MOCK.bots.platform
const AGENCY = TELEGRAM_MOCK.bots.agency
const logger = createLogger({ service: 'worker', level: 'error' })
// the keys with their values: what an answer says, without the panel's texts
const t: Translate = (key, values) =>
  values === undefined ? key : `${key} ${JSON.stringify(values)}`

const run = () => pollTelegram(poll)
const sentTo = (chatId: number) => mock.sent().filter((m) => m.chatId === chatId)
const lastTo = (chatId: number) => sentTo(chatId).at(-1)?.text ?? ''

async function link(userId: string, bot: string, chatId: number, token: string) {
  const { url } = await startTelegramLink(links, userId, bot)
  const code = new URL(url).searchParams.get('start') ?? ''
  mock.userWrites(token, { chatId, text: `/start ${code}` })
  await run()
  return code
}

const chatOf = async (userId: string, organizationId: string | null) =>
  (
    await admin.query<{ chat_id: string | null }>(
      `select chat_id from telegram_links
        where user_id = $1 and organization_id is not distinct from $2`,
      [userId, organizationId],
    )
  ).rows[0]?.chat_id ?? null

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 6, applicationName: 'test' })
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  mock = await startTelegramMock()
  const keyRing = createKeyRing({ platformKey: randomBytes(32), clock: systemClock })
  const integrations = createIntegrationStore({ keyRing })
  const uow = createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger })
  const tokens = createTokenService()
  poll = {
    uow,
    clock: systemClock,
    logger,
    t,
    panelUrl: new URL('https://pannello.example/'),
    integrations,
    telegram: createTelegramBotApi({ baseUrl: new URL(mock.url), timeoutMs: 2000 }),
    tokens,
    lock: createAdvisoryLock(handle.pool),
    waitSeconds: 0,
  }
  links = {
    uow,
    clock: systemClock,
    integrations,
    tokens,
    platformBotName: () =>
      uow.runAsSystem(
        'test',
        async (tx) => (await integrations.getPlatform(tx, 'telegram'))?.config.botUsername ?? null,
      ),
  }
  ;({ alfa, beta, pia, quinto, clientA, clientB, clientQ } = await seed(
    tdb.runtimeUrl,
    async (s) => {
      const a = await s.organization()
      const b = await s.organization()
      const p = await s.user({ name: 'Pia' })
      const q = await s.user({ name: 'Quinto' })
      await s.member(a, p, 'owner')
      await s.member(b, p, 'owner')
      await s.member(b, q, 'member')
      // Quinto works on one client of Beta only
      const own = await s.workspace(b, { name: 'Cliente di Quinto' })
      await s.workspaceMember(b, own, q, 'editor')
      return {
        clientQ: own,
        alfa: a,
        beta: b,
        pia: p,
        quinto: q,
        clientA: await s.workspace(a, { name: 'Cliente Alfa' }),
        clientB: await s.workspace(b, { name: 'Cliente Beta' }),
      }
    },
  ))
  await admin.query("update organizations set name = 'Alfa' where id = $1", [alfa])
  await admin.query("update organizations set name = 'Beta' where id = $1", [beta])
  await uow.run({ organizationId: alfa, userId: pia }, (tx) =>
    keyRing.createOrganizationKey(tx, alfa),
  )
}, 120_000)

beforeEach(async () => {
  mock.reset()
  await admin.query('delete from telegram_links')
  await admin.query("delete from integrations where kind = 'telegram'")
  await poll.uow.runAsSystem('test: the platform bot', (tx) =>
    poll.integrations.replacePlatform(tx, 'telegram', {
      config: { botId: PLATFORM.id, botUsername: PLATFORM.username },
      secret: PLATFORM.token,
      updatedBy: null,
    }),
  )
  await poll.uow.run({ organizationId: alfa, userId: pia }, (tx) =>
    poll.integrations.replace(tx, alfa, 'telegram', {
      config: { botId: AGENCY.id, botUsername: AGENCY.username },
      secret: AGENCY.token,
      updatedBy: pia,
      expectedVersion: null,
      verifiedAt: new Date(),
    }),
  )
})

afterAll(async () => {
  await mock.stop()
  await admin.end()
  await handle.close()
  await tdb.stop()
})

test('each bot that writes to a person: the platform’s for Beta, Alfa’s own for Alfa', async () => {
  const bots = await listTelegramLinks(links, pia)
  expect(bots.map((b) => [b.bot, b.botUsername, b.agencies])).toEqual([
    ['platform', PLATFORM.username, ['Beta']],
    [alfa, AGENCY.username, ['Alfa']],
  ])
  expect(bots.every((b) => b.linkedAt === null && b.pendingUntil === null)).toBe(true)
  expect((await listTelegramLinks(links, quinto)).map((b) => b.bot)).toEqual(['platform'])
  // a bot that does not write to the person is not linked
  await expect(startTelegramLink(links, quinto, alfa)).rejects.toMatchObject({ code: 'NOT_FOUND' })
})

test('the link: «Avvia» with the code joins the chat once; the code is kept only as a hash', async () => {
  const { url, expiresAt } = await startTelegramLink(links, pia, 'platform')
  const code = new URL(url).searchParams.get('start') ?? ''
  expect(url.startsWith(`https://t.me/${PLATFORM.username}?start=`)).toBe(true)
  expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60_000)
  const stored = await admin.query<{ link_code_hash: string }>(
    'select link_code_hash from telegram_links where user_id = $1',
    [pia],
  )
  expect(JSON.stringify(stored.rows)).not.toContain(code)
  expect((await listTelegramLinks(links, pia))[0]?.pendingUntil).not.toBeNull()

  mock.userWrites(PLATFORM.token, { chatId: 101, text: `/start ${code}` })
  await run()
  expect(await chatOf(pia, null)).toBe('101')
  expect(lastTo(101)).toContain('notify.telegram.start.linked')
  expect((await listTelegramLinks(links, pia))[0]?.linkedAt).not.toBeNull()

  // once only, and only with its own bot
  mock.userWrites(PLATFORM.token, { chatId: 102, text: `/start ${code}` })
  const forAlfa = await startTelegramLink(links, pia, alfa)
  mock.userWrites(PLATFORM.token, {
    chatId: 103,
    text: `/start ${new URL(forAlfa.url).searchParams.get('start') ?? ''}`,
  })
  await run()
  expect(lastTo(102)).toContain('<b>')
  expect(lastTo(102)).toContain('notify.telegram.start.invalid')
  expect(lastTo(103)).toContain('<b>')
  expect(lastTo(103)).toContain('notify.telegram.start.invalid')
  expect(await chatOf(pia, alfa)).toBeNull()
})

test('an expired code links nothing', async () => {
  const { url } = await startTelegramLink(links, pia, 'platform')
  await admin.query(
    "update telegram_links set link_code_expires_at = now() - interval '1 second' where user_id = $1",
    [pia],
  )
  mock.userWrites(PLATFORM.token, {
    chatId: 101,
    text: `/start ${new URL(url).searchParams.get('start') ?? ''}`,
  })
  await run()
  expect(lastTo(101)).toContain('<b>')
  expect(lastTo(101)).toContain('notify.telegram.start.invalid')
  expect(await chatOf(pia, null)).toBeNull()
})

test('one chat, one person per bot: the latest /start wins', async () => {
  await link(pia, 'platform', 101, PLATFORM.token)
  await link(quinto, 'platform', 101, PLATFORM.token)
  expect(await chatOf(quinto, null)).toBe('101')
  expect(await chatOf(pia, null)).toBeNull()
})

test('/oggi and /problemi: each bot speaks for its agencies, each person of what they see', async () => {
  const post = (organizationId: string, workspaceId: string, status: string, caption: string) =>
    admin.query(
      `insert into posts (id, organization_id, workspace_id, type, status, scheduled_at, caption,
                          options, created_by, updated_by)
       values ($1, $2, $3, 'photo', $4, now(), $5, '{"shareToFeed":true,"choices":[]}', $6, $6)`,
      [uuidV7Generator.newId(), organizationId, workspaceId, status, caption, pia],
    )
  await post(alfa, clientA, 'scheduled', 'Il post di Alfa')
  await post(beta, clientB, 'scheduled', 'Il post di Beta')
  await post(beta, clientB, 'failed', 'Il post non uscito di Beta')
  await post(beta, clientQ, 'scheduled', 'Il post <del> cliente di Quinto & co')
  await link(pia, 'platform', 101, PLATFORM.token)
  await link(pia, alfa, 201, AGENCY.token)
  await link(quinto, 'platform', 301, PLATFORM.token)

  mock.userWrites(PLATFORM.token, { chatId: 101, text: '/oggi' })
  mock.userWrites(AGENCY.token, { chatId: 201, text: '/oggi@agenzia_mock_bot' })
  mock.userWrites(PLATFORM.token, { chatId: 301, text: '/oggi' })
  await run()
  expect(lastTo(101)).toContain('Il post di Beta')
  expect(lastTo(101)).not.toContain('Il post di Alfa')
  expect(lastTo(101)).toContain('https://pannello.example/')
  expect(lastTo(201)).toContain('Il post di Alfa')
  expect(lastTo(201)).not.toContain('Beta')
  // Quinto is in Beta, on his client only: that one, and nothing of the others
  expect(lastTo(301)).not.toContain('Il post di Beta')
  expect(lastTo(301)).toContain('Cliente di Quinto')
  expect(lastTo(301)).toContain('<i>«Il post &lt;del&gt; cliente di Quinto &amp; co»</i>')

  mock.userWrites(PLATFORM.token, { chatId: 101, text: '/problemi' })
  mock.userWrites(PLATFORM.token, { chatId: 301, text: '/problemi' })
  await run()
  expect(lastTo(101)).toContain('notify.telegram.issues.post')
  expect(lastTo(101)).toContain('Cliente Beta')
  expect(lastTo(301)).toContain('notify.telegram.issues.none')
})

test('a long day still fits one message: lines go, the link stays', async () => {
  for (let i = 0; i < 60; i += 1)
    await admin.query(
      `insert into posts (id, organization_id, workspace_id, type, status, scheduled_at, caption,
                          options, created_by, updated_by)
       values ($1, $2, $3, 'photo', 'scheduled', now(), $4,
               '{"shareToFeed":true,"choices":[]}', $5, $5)`,
      [uuidV7Generator.newId(), beta, clientB, `Post ${String(i)} ${'lungo '.repeat(40)}`, pia],
    )
  await link(pia, 'platform', 101, PLATFORM.token)
  mock.userWrites(PLATFORM.token, { chatId: 101, text: '/oggi' })
  await run()
  // the mock refuses what Telegram would: a text too long or HTML it cannot read
  expect(lastTo(101)).toContain('notify.telegram.more')
  expect(lastTo(101)).toContain('<a href="https://pannello.example/')
  await admin.query('delete from posts where organization_id = $1 and caption like $2', [
    beta,
    'Post %',
  ])
})

test('/stop unlinks; an unknown chat or command gets the way to link, or the help', async () => {
  await link(pia, 'platform', 101, PLATFORM.token)
  mock.userWrites(PLATFORM.token, { chatId: 101, text: 'ciao' })
  mock.userWrites(PLATFORM.token, { chatId: 999, text: '/oggi' })
  mock.userWrites(PLATFORM.token, { chatId: 998, text: '/start' })
  await run()
  expect(lastTo(101)).toContain('<b>')
  expect(lastTo(101)).toContain('notify.telegram.help')
  expect(lastTo(999)).toContain('<b>')
  expect(lastTo(999)).toContain('notify.telegram.notLinked')
  expect(lastTo(998)).toContain('<b>')
  expect(lastTo(998)).toContain('notify.telegram.start.missing')
  mock.userWrites(PLATFORM.token, { chatId: 101, text: '/stop' })
  await run()
  expect(lastTo(101)).toContain('<b>')
  expect(lastTo(101)).toContain('notify.telegram.stop')
  expect(await chatOf(pia, null)).toBeNull()
})

test('the offset: an update is answered once, by one of two workers polling together', async () => {
  await link(pia, 'platform', 101, PLATFORM.token)
  mock.userWrites(PLATFORM.token, { chatId: 101, text: '/oggi' })
  const slow = { ...poll, waitSeconds: 1 }
  const [first, second] = await Promise.all([pollTelegram(slow), pollTelegram(slow)])
  expect(first.busy + second.busy).toBe(2)
  await run()
  expect(sentTo(101).filter((m) => m.text.includes('notify.telegram.today'))).toHaveLength(1)
})

test('one run listens for its whole time: a second message is answered in the same run (R3)', async () => {
  await link(pia, 'platform', 101, PLATFORM.token)
  mock.userWrites(PLATFORM.token, { chatId: 101, text: '/oggi' })
  const today = () => sentTo(101).filter((m) => m.text.includes('notify.telegram.today'))
  const running = pollTelegram({ ...poll, waitSeconds: 3 })
  await expect.poll(() => today().length, { timeout: 2000, interval: 20 }).toBe(1)
  // the offset of the first batch is saved before the next long poll
  const { rows } = await admin.query<{ offset: number }>(
    "select (state->>'offset')::int as offset from integrations where kind = 'telegram' and organization_id is null",
  )
  const pending = mock
    .calls()
    .filter((c) => c.method === 'getUpdates')
    .at(-1)
  expect(Number(pending?.params.offset)).toBe(rows[0]?.offset)
  mock.userWrites(PLATFORM.token, { chatId: 101, text: '/problemi' })
  await expect
    .poll(() => sentTo(101).some((m) => m.text.includes('notify.telegram.issues')), {
      timeout: 2000,
      interval: 20,
    })
    .toBe(true)
  const report = await running
  expect(report.updates).toBe(2)
  expect(today()).toHaveLength(1)
})

test('each bot gets its menu of commands once, at its first run (R10.1)', async () => {
  await run()
  const menu = [
    { command: 'oggi', description: 'Notify.telegram.commands.today' },
    { command: 'problemi', description: 'Notify.telegram.commands.issues' },
    { command: 'stop', description: 'Notify.telegram.commands.stop' },
  ]
  expect(mock.commands()).toEqual({ [PLATFORM.username]: menu, [AGENCY.username]: menu })
  await run()
  expect(mock.calls().filter((c) => c.method === 'setMyCommands')).toHaveLength(2)
})

test('a menu Telegram does not take is tried again at the next run; the poll goes on', async () => {
  mock.unavailable({ method: 'setMyCommands', times: 2 })
  mock.userWrites(PLATFORM.token, { chatId: 101, text: '/oggi' })
  await run()
  expect(mock.commands()).toEqual({})
  expect(sentTo(101)).toHaveLength(1)
  await run()
  expect(Object.keys(mock.commands()).sort()).toEqual([AGENCY.username, PLATFORM.username].sort())
})

test('a bot removed or replaced by another takes its links away', async () => {
  await link(pia, 'platform', 101, PLATFORM.token)
  await link(pia, alfa, 201, AGENCY.token)
  // Alfa's bot is now another one: its chats are not the new bot's
  await admin.query(
    `update integrations set config = jsonb_set(config, '{botId}', '1000000099')
      where kind = 'telegram' and organization_id = $1`,
    [alfa],
  )
  expect((await run()).cleaned).toBe(1)
  expect(await chatOf(pia, alfa)).toBeNull()
  expect(await chatOf(pia, null)).toBe('101')
  // and the platform's bot is taken away
  await admin.query("delete from integrations where kind = 'telegram' and organization_id is null")
  expect((await run()).cleaned).toBe(1)
  expect(await chatOf(pia, null)).toBeNull()
})

test('a token revoked with @BotFather turns the bot red and is not polled again', async () => {
  mock.revoke(PLATFORM.token)
  await run()
  const { rows } = await admin.query<{ rejected_at: Date | null }>(
    "select rejected_at from integrations where kind = 'telegram' and organization_id is null",
  )
  expect(rows[0]?.rejected_at).not.toBeNull()
  const calls = mock.calls().length
  await run()
  expect(mock.calls().filter((c) => c.bot === PLATFORM.username).length).toBe(
    mock
      .calls()
      .slice(0, calls)
      .filter((c) => c.bot === PLATFORM.username).length,
  )
})

test('the channel: through the agency’s bot or the platform’s; a block unlinks the chat', async () => {
  await link(pia, 'platform', 101, PLATFORM.token)
  await link(pia, alfa, 201, AGENCY.token)
  const channel = createTelegramChannel({
    t,
    telegram: poll.telegram,
    targets: createTelegramTargets(poll),
  })
  const recipient = (organizationId: string | null): ChannelRecipient => ({
    userId: pia,
    organizationId,
    email: 'pia@example.com',
    name: 'Pia',
  })
  const message = {
    level: 'critical' as const,
    title: 'Un post non è uscito',
    context: 'Beta · Cliente Beta',
    lines: ['Instagram · «Ciao»'],
    more: 2,
    link: { label: 'Apri il post', url: 'https://pannello.example/beta/post/1' },
  }
  for (const [organizationId, chat] of [
    [beta, 101],
    [alfa, 201],
  ] as const) {
    expect(
      await poll.uow.run({ organizationId, userId: pia }, (tx) =>
        channel.isAvailable(tx, recipient(organizationId)),
      ),
    ).toBe(true)
    expect(
      await channel.send(recipient(organizationId), message, AbortSignal.timeout(5000)),
    ).toEqual({ outcome: 'sent' })
    expect(lastTo(chat)).toContain('Un post non è uscito')
    expect(lastTo(chat)).toContain('• Instagram · «Ciao»')
    expect(lastTo(chat)).toContain(
      '<a href="https://pannello.example/beta/post/1">Apri il post →</a>',
    )
  }
  // Quinto never linked: nothing to send to
  expect(
    await poll.uow.run({ organizationId: beta, userId: quinto }, (tx) =>
      channel.isAvailable(tx, { ...recipient(beta), userId: quinto }),
    ),
  ).toBe(false)

  mock.block(101)
  expect(await channel.send(recipient(beta), message, AbortSignal.timeout(5000))).toEqual({
    outcome: 'failed',
    error: 'notify.telegram.errors.blocked',
    retry: false,
  })
  expect(await chatOf(pia, null)).toBeNull()
  mock.rateLimit({ retryAfter: 1 })
  expect(await channel.send(recipient(alfa), message, AbortSignal.timeout(5000))).toMatchObject({
    outcome: 'failed',
    retry: true,
  })
})

test('the person unlinks from the panel', async () => {
  await link(pia, alfa, 201, AGENCY.token)
  await unlinkTelegram(links, pia, alfa)
  expect(await chatOf(pia, alfa)).toBeNull()
  await expect(unlinkTelegram(links, pia, 'non-un-bot')).rejects.toMatchObject({
    code: 'NOT_FOUND',
  })
})

test('a code of someone disabled since links nothing', async () => {
  const { url } = await startTelegramLink(links, quinto, 'platform')
  await admin.query("update users set status = 'disabled', disabled_at = now() where id = $1", [
    quinto,
  ])
  try {
    mock.userWrites(PLATFORM.token, {
      chatId: 301,
      text: `/start ${new URL(url).searchParams.get('start') ?? ''}`,
    })
    await run()
    expect(lastTo(301)).toContain('notify.telegram.start.invalid')
    expect(lastTo(301)).not.toContain('Quinto')
    expect(await chatOf(quinto, null)).toBeNull()
  } finally {
    await admin.query("update users set status = 'active', disabled_at = null where id = $1", [
      quinto,
    ])
  }
})

test('a bot whose token cannot be opened stops only itself, and keeps its links', async () => {
  await link(pia, 'platform', 101, PLATFORM.token)
  await link(pia, alfa, 201, AGENCY.token)
  await admin.query(
    "update integrations set secret_enc = 'rotto' where kind = 'telegram' and organization_id = $1",
    [alfa],
  )
  mock.userWrites(PLATFORM.token, { chatId: 101, text: '/oggi' })
  const report = await run()
  expect(report.bots).toBe(1)
  expect(lastTo(101)).toContain('notify.telegram.today.title')
  expect(await chatOf(pia, alfa)).toBe('201')
})

test('a bot saved after another was removed starts without the old chats', async () => {
  await link(pia, alfa, 201, AGENCY.token)
  // removed and saved again (here: the same bot) before the next run: never polled yet
  await admin.query(
    "update integrations set state = '{}' where kind = 'telegram' and organization_id = $1",
    [alfa],
  )
  await startTelegramLink(links, quinto, 'platform')
  expect((await run()).cleaned).toBe(1)
  expect(await chatOf(pia, alfa)).toBeNull()
  // a code not yet used stays (here, of the other bot): Pia links again to the new bot
  expect((await listTelegramLinks(links, quinto))[0]?.pendingUntil).not.toBeNull()
  const again = await startTelegramLink(links, pia, alfa)
  mock.userWrites(AGENCY.token, {
    chatId: 202,
    text: `/start ${new URL(again.url).searchParams.get('start') ?? ''}`,
  })
  await run()
  expect(await chatOf(pia, alfa)).toBe('202')
})

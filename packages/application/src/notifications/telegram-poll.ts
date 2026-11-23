import { displayName } from '@app/domain'
import type { Clock } from '../ports/clock.js'
import type { IntegrationStore, TelegramBotCredentials } from '../ports/integration-store.js'
import type { Logger } from '../ports/logger.js'
import type { ExclusiveLock } from '../ports/media-processing.js'
import type { TelegramBotOwner } from '../ports/notifications.js'
import {
  TelegramApiError,
  type TelegramBotApi,
  type TelegramUpdate,
} from '../ports/telegram-bot-api.js'
import type { TokenService } from '../ports/token-service.js'
import type { Translate } from '../ports/translator.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import type { TelegramTargets } from './telegram-channel.js'
import { telegramOwnerOf } from './telegram-channel.js'
import { answerTelegramQuery, type TelegramQuery } from './telegram-commands.js'
import { bold, joinHtml, link, plain, type TelegramHtml } from './telegram-format.js'
import { linkCodeHash } from './telegram-links.js'

// `telegram.poll` (plan 08 Task 7): every minute one worker holds the lock and long-polls
// `getUpdates` of every bot for about 50 seconds, the offset kept in `integrations.state`. The bots'
// tokens are read only here, in the system scope (and for the channel's sends, below). A chat is
// found in the system scope too; each answer is then computed in the scope of the person linked.

export interface TelegramPollDeps {
  uow: UnitOfWork
  clock: Clock
  logger: Logger
  t: Translate
  panelUrl: URL
  integrations: IntegrationStore
  telegram: TelegramBotApi
  tokens: Pick<TokenService, 'hash'>
  lock: ExclusiveLock
  /** How long each `getUpdates` waits for a message: about 50 s in the worker, 0 in the tests */
  waitSeconds: number
}

export interface TelegramPollReport {
  bots: number
  /** Bots another worker was polling */
  busy: number
  updates: number
  /** Links taken away: a bot removed or replaced by another */
  cleaned: number
}

const COMMANDS: Readonly<Record<string, TelegramQuery>> = {
  '/oggi': 'today',
  '/problemi': 'issues',
}

/** The links of bots that are no more or changed, and each bot with its token. */
async function botsAndCleanUp(
  deps: TelegramPollDeps,
): Promise<{ bots: TelegramBotCredentials[]; cleaned: number }> {
  return deps.uow.runAsSystem('telegram.poll: the bots and their links', async (tx) => {
    const { bots, unreadable } = await deps.integrations.telegramBots(tx)
    for (const organizationId of unreadable)
      deps.logger.error({ organizationId }, 'telegram bot token cannot be opened: bot not polled')
    let cleaned = 0
    for (const bot of bots) {
      if (bot.state.botId === bot.botId) continue
      // another bot with the same owner: its chats are not this bot's, and its offset neither.
      // A bot never polled (just saved, maybe after another was removed) has no chat yet: the
      // chats there are of the bot before; a code just started may be for this one.
      cleaned += await tx.telegramLinks.deleteForBot(bot.organizationId, {
        linkedOnly: bot.state.botId === undefined,
      })
      const state = { botId: bot.botId }
      if (await tx.integrations.saveState(bot.organizationId, 'telegram', state, bot.updatedAt))
        bot.state = state
    }
    // a bot not read this time is still there: its links stay
    const owners = [...bots.map((b) => b.organizationId), ...unreadable]
    cleaned += await tx.telegramLinks.deleteOrphans({
      agencyBots: owners.filter((o): o is string => o !== null),
      platformBot: owners.includes(null),
    })
    return { bots, cleaned }
  })
}

/** `/oggi@feedway_bot` is `/oggi`; the argument of `/start` follows a space. */
export function parseCommand(text: string): { command: string; argument: string } {
  const [head = '', ...rest] = text.trim().split(/\s+/)
  return { command: head.split('@')[0]?.toLowerCase() ?? '', argument: rest.join(' ') }
}

/** Where the person links, or links again, Telegram: «Profilo e preferenze». */
const accountLink = (deps: TelegramPollDeps) =>
  link(new URL('account', deps.panelUrl).toString(), deps.t('notify.telegram.account'))

/** A short answer: a bold first line, a sentence, and what to do next. */
const note = (title: string, body: string, ...after: TelegramHtml[]) =>
  joinHtml([joinHtml([bold(title), plain(body)]), ...after], '\n\n')

function commands(t: Translate): TelegramHtml {
  return joinHtml([
    bold(t('notify.telegram.help')),
    plain(`/oggi · ${t('notify.telegram.commands.today')}`),
    plain(`/problemi · ${t('notify.telegram.commands.issues')}`),
    plain(`/stop · ${t('notify.telegram.commands.stop')}`),
  ])
}

async function answer(
  deps: TelegramPollDeps,
  bot: TelegramBotCredentials,
  agencyBots: ReadonlySet<string>,
  message: { chatId: number; text: string },
): Promise<TelegramHtml> {
  const { t } = deps
  const owner = bot.organizationId
  const { command, argument } = parseCommand(message.text)
  if (command === '/start' && argument !== '') {
    const linked = await deps.uow.runAsSystem('telegram.poll: a /start', async (tx) => {
      const done = await tx.telegramLinks.completeByCode({
        organizationId: owner,
        codeHash: linkCodeHash(deps.tokens, argument),
        chatId: message.chatId,
        now: deps.clock.now(),
      })
      if (done === null) return null
      // read again: someone disabled, or out of the bot's agency, since the code was made
      const user = await tx.users.findById(done.userId)
      const member =
        owner === null || (await tx.orgMembers.find(owner, done.userId))?.status === 'active'
      if (user?.status === 'active' && member) return user
      await tx.telegramLinks.deleteByChat(owner, message.chatId)
      return null
    })
    return linked
      ? note(
          `✅ ${t('notify.telegram.start.linked', { name: displayName(linked) })}`,
          t('notify.telegram.start.linkedBody'),
          commands(t),
        )
      : note(
          `⏱️ ${t('notify.telegram.start.invalid')}`,
          t('notify.telegram.start.invalidBody'),
          accountLink(deps),
        )
  }
  if (command === '/stop') {
    const gone = await deps.uow.runAsSystem('telegram.poll: a /stop', (tx) =>
      tx.telegramLinks.deleteByChat(owner, message.chatId),
    )
    return gone > 0
      ? note(`👋 ${t('notify.telegram.stop')}`, t('notify.telegram.stopBody'), accountLink(deps))
      : notLinked(deps)
  }
  const who = await deps.uow.runAsSystem('telegram.poll: who the chat is', (tx) =>
    tx.telegramLinks.findByChat(owner, message.chatId),
  )
  if (who === null)
    return command === '/start'
      ? note(
          `👋 ${t('notify.telegram.start.missing')}`,
          t('notify.telegram.start.missingBody'),
          accountLink(deps),
        )
      : notLinked(deps)
  const query = COMMANDS[command]
  if (query === undefined) return commands(t)
  return answerTelegramQuery(deps, { userId: who.userId, owner, agencyBots, query })
}

const notLinked = (deps: TelegramPollDeps) =>
  note(
    `🔗 ${deps.t('notify.telegram.notLinked')}`,
    deps.t('notify.telegram.notLinkedBody'),
    accountLink(deps),
  )

async function reply(
  deps: TelegramPollDeps,
  bot: TelegramBotCredentials,
  chatId: number,
  text: TelegramHtml,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await deps.telegram.sendMessage(bot.token, { chatId, html: text }, signal)
  } catch (error) {
    if (!(error instanceof TelegramApiError)) throw error
    if (error.kind === 'blocked')
      await deps.uow.runAsSystem('telegram.poll: a chat blocked the bot', (tx) =>
        tx.telegramLinks.deleteByChat(bot.organizationId, chatId),
      )
    else deps.logger.warn({ bot: bot.botUsername, kind: error.kind }, 'telegram reply not sent')
  }
}

async function pollBot(
  deps: TelegramPollDeps,
  bot: TelegramBotCredentials,
  agencyBots: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<number> {
  let updates: TelegramUpdate[]
  try {
    updates = await deps.telegram.getUpdates(
      bot.token,
      { offset: bot.state.offset ?? 0, timeoutSeconds: deps.waitSeconds },
      signal,
    )
  } catch (error) {
    if (!(error instanceof TelegramApiError)) throw error
    if (error.kind === 'unauthorized') {
      // revoked with @BotFather: red on the bot's page until a new token is saved
      await deps.uow.runAsSystem('telegram.poll: a bot refused', (tx) =>
        bot.organizationId === null
          ? tx.integrations.markPlatformRejected('telegram', deps.clock.now(), bot.updatedAt)
          : tx.integrations.markRejected(
              bot.organizationId,
              'telegram',
              deps.clock.now(),
              bot.updatedAt,
            ),
      )
      deps.logger.warn({ bot: bot.botUsername }, 'telegram bot token refused')
    } else deps.logger.warn({ bot: bot.botUsername, kind: error.kind }, 'telegram poll failed')
    return 0
  }
  let offset = bot.state.offset ?? 0
  for (const update of updates) {
    offset = Math.max(offset, update.updateId + 1)
    if (update.message === null) continue
    try {
      const text = await answer(deps, bot, agencyBots, update.message)
      await reply(deps, bot, update.message.chatId, text, signal)
    } catch (error) {
      // one message that fails is not read again: the others go on (never its text in the log)
      deps.logger.error(
        { bot: bot.botUsername, updateId: update.updateId, err: error },
        'telegram update not handled',
      )
    }
  }
  if (updates.length > 0)
    await deps.uow.runAsSystem('telegram.poll: the offset', (tx) =>
      tx.integrations.saveState(
        bot.organizationId,
        'telegram',
        { botId: bot.botId, offset },
        bot.updatedAt,
      ),
    )
  return updates.length
}

/**
 * One run of `telegram.poll`: every bot not refused, long-polled together under one lock for the
 * whole installation. One lock, not one per bot: a session lock holds a database connection for
 * the ~50 s of the wait, and the worker's pool is small.
 */
export async function pollTelegram(
  deps: TelegramPollDeps,
  signal?: AbortSignal,
): Promise<TelegramPollReport> {
  const { bots, cleaned } = await botsAndCleanUp(deps)
  const agencyBots = new Set(
    bots.flatMap((b) => (b.organizationId === null ? [] : [b.organizationId])),
  )
  const polled = bots.filter((bot) => bot.rejectedAt === null)
  const report: TelegramPollReport = { bots: polled.length, busy: 0, updates: 0, cleaned }
  if (polled.length === 0) return report
  const run = await deps.lock.tryRun('telegram.poll', async () => {
    const results = await Promise.allSettled(
      polled.map((bot) => pollBot(deps, bot, agencyBots, signal)),
    )
    let updates = 0
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') updates += result.value
      // one bot that fails (its offset not saved) does not stop the others
      else
        deps.logger.error(
          { bot: polled[i]?.botUsername, err: result.reason as unknown },
          'telegram poll of a bot failed',
        )
    })
    return updates
  })
  if (run.acquired) report.updates = run.value
  else report.busy = polled.length
  return report
}

/**
 * The chat and the token a delivery is sent with (the channel's `send`, outside any agency
 * transaction): the bot as `isAvailable` chose it, read again in the system scope.
 */
export function createTelegramTargets(
  deps: Pick<TelegramPollDeps, 'uow' | 'integrations'>,
): TelegramTargets {
  return {
    find: (recipient) =>
      deps.uow.runAsSystem('telegram: the chat of a delivery', async (tx) => {
        const owner: TelegramBotOwner = await telegramOwnerOf(tx, recipient)
        const link = await tx.telegramLinks.findLinked(owner, recipient.userId)
        if (link === null) return null
        const credentials =
          owner === null
            ? await deps.integrations.platformCredentials(tx, 'telegram')
            : await deps.integrations.credentials(tx, owner, 'telegram')
        return credentials === null
          ? null
          : { owner, token: credentials.secret, chatId: link.chatId }
      }),
    unlink: async (owner, chatId) => {
      await deps.uow.runAsSystem('telegram: a chat blocked the bot', (tx) =>
        tx.telegramLinks.deleteByChat(owner, chatId),
      )
    },
  }
}

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
import { linkCodeHash } from './telegram-links.js'

// `telegram.poll` (plan 08 Task 7): every minute, for each bot, one worker holds its lock and
// long-polls `getUpdates` for about 50 seconds, the offset kept in `integrations.state`. The bots'
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
    const bots = await deps.integrations.telegramBots(tx)
    let cleaned = 0
    for (const bot of bots) {
      if (bot.state.botId === bot.botId) continue
      // another bot with the same owner: its chats are not this bot's, and its offset neither
      if (bot.state.botId !== undefined)
        cleaned += await tx.telegramLinks.deleteForBot(bot.organizationId)
      const state = { botId: bot.botId }
      if (await tx.integrations.saveState(bot.organizationId, 'telegram', state, bot.updatedAt))
        bot.state = state
    }
    cleaned += await tx.telegramLinks.deleteOrphans({
      agencyBots: bots.flatMap((b) => (b.organizationId === null ? [] : [b.organizationId])),
      platformBot: bots.some((b) => b.organizationId === null),
    })
    return { bots, cleaned }
  })
}

/** `/oggi@feedway_bot` is `/oggi`; the argument of `/start` follows a space. */
export function parseCommand(text: string): { command: string; argument: string } {
  const [head = '', ...rest] = text.trim().split(/\s+/)
  return { command: head.split('@')[0]?.toLowerCase() ?? '', argument: rest.join(' ') }
}

async function answer(
  deps: TelegramPollDeps,
  bot: TelegramBotCredentials,
  agencyBots: ReadonlySet<string>,
  message: { chatId: number; text: string },
): Promise<string> {
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
      return done === null ? null : await tx.users.findById(done.userId)
    })
    return linked
      ? t('notify.telegram.start.linked', { name: displayName(linked) })
      : t('notify.telegram.start.invalid')
  }
  if (command === '/stop') {
    const gone = await deps.uow.runAsSystem('telegram.poll: a /stop', (tx) =>
      tx.telegramLinks.deleteByChat(owner, message.chatId),
    )
    return t(gone > 0 ? 'notify.telegram.stop' : 'notify.telegram.notLinked')
  }
  const who = await deps.uow.runAsSystem('telegram.poll: who the chat is', (tx) =>
    tx.telegramLinks.findByChat(owner, message.chatId),
  )
  if (who === null)
    return t(command === '/start' ? 'notify.telegram.start.missing' : 'notify.telegram.notLinked')
  const query = COMMANDS[command]
  if (query === undefined) return t('notify.telegram.help')
  return answerTelegramQuery(deps, { userId: who.userId, owner, agencyBots, query })
}

async function reply(
  deps: TelegramPollDeps,
  bot: TelegramBotCredentials,
  chatId: number,
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await deps.telegram.sendMessage(bot.token, { chatId, text }, signal)
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

/** One run of `telegram.poll`: every bot not refused, each under its own lock. */
export async function pollTelegram(
  deps: TelegramPollDeps,
  signal?: AbortSignal,
): Promise<TelegramPollReport> {
  const { bots, cleaned } = await botsAndCleanUp(deps)
  const agencyBots = new Set(
    bots.flatMap((b) => (b.organizationId === null ? [] : [b.organizationId])),
  )
  const report: TelegramPollReport = { bots: 0, busy: 0, updates: 0, cleaned }
  await Promise.all(
    bots
      .filter((bot) => bot.rejectedAt === null)
      .map(async (bot) => {
        report.bots += 1
        const run = await deps.lock.tryRun(`telegram.poll:${String(bot.botId)}`, () =>
          pollBot(deps, bot, agencyBots, signal),
        )
        if (run.acquired) report.updates += run.value
        else report.busy += 1
      }),
  )
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

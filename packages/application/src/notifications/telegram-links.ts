import { DomainError } from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { Clock } from '../ports/clock.js'
import type { IntegrationStore } from '../ports/integration-store.js'
import type { TelegramBotOwner } from '../ports/notifications.js'
import type { TokenService } from '../ports/token-service.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

// «Collega Telegram» in Profilo e preferenze (plan 08 Task 7): a person links a chat to each bot
// that writes to them. The platform's serves the agencies without a bot of their own (and the
// platform administrator); an agency's own serves only that agency (Scelta 8). The link opens
// `t.me/<bot>?start=<code>`: the code is random, lasts 15 minutes, works once and only its hash
// is kept. The chat is joined by `telegram.poll` when the person presses «Avvia».

export const LINK_CODE_MINUTES = 15

export interface TelegramLinkDeps {
  uow: UnitOfWork
  clock: Clock
  integrations: IntegrationStore
  tokens: TokenService
  /** The platform bot's name (the platform module reads it in the system scope); null: none */
  platformBotName: () => Promise<string | null>
}

/** `platform`, or the id of the agency whose own bot it is. */
export type TelegramBotKey = 'platform' | (string & {})

export interface TelegramBotLink {
  bot: TelegramBotKey
  botUsername: string
  /** The agencies whose notifications come through this bot, by name */
  agencies: string[]
  /** The platform's notifications come through it too (the person is its administrator) */
  platform: boolean
  linkedAt: Date | null
  /** A code is waiting for its `/start` until then */
  pendingUntil: Date | null
}

const ownerOf = (bot: TelegramBotKey): TelegramBotOwner => (bot === 'platform' ? null : bot)
const keyOf = (owner: TelegramBotOwner): TelegramBotKey => owner ?? 'platform'

/** The code's hash as it is stored, hex. */
export const linkCodeHash = (tokens: Pick<TokenService, 'hash'>, code: string) =>
  tokens.hash(code).toString('hex')

/** The bots that write to the person, with the state of the person's link to each. */
export async function listTelegramLinks(
  deps: TelegramLinkDeps,
  userId: string,
): Promise<TelegramBotLink[]> {
  const now = deps.clock.now()
  const { user, memberships, links } = await deps.uow.run({ userId }, async (tx) => ({
    user: await tx.users.findById(userId),
    memberships: (await tx.orgMembers.listForUser(userId)).filter(
      (m) => m.status === 'active' && m.organizationStatus === 'active',
    ),
    links: await tx.telegramLinks.listForUser(userId),
  }))
  if (user?.status !== 'active') return []
  const own = new Map<string, string>()
  const onPlatform: string[] = []
  for (const m of memberships) {
    const bot = await deps.uow.run({ organizationId: m.organizationId, userId }, (tx) =>
      deps.integrations.get(tx, m.organizationId, 'telegram'),
    )
    if (bot) own.set(m.organizationId, bot.config.botUsername)
    else onPlatform.push(m.name)
  }
  const result: TelegramBotLink[] = []
  const platformAdmin = user.platformRole === 'admin'
  if (onPlatform.length > 0 || platformAdmin) {
    const name = await deps.platformBotName()
    if (name !== null)
      result.push({
        bot: 'platform',
        botUsername: name,
        agencies: onPlatform,
        platform: platformAdmin,
        linkedAt: null,
        pendingUntil: null,
      })
  }
  for (const m of memberships) {
    const name = own.get(m.organizationId)
    if (name !== undefined)
      result.push({
        bot: m.organizationId,
        botUsername: name,
        agencies: [m.name],
        platform: false,
        linkedAt: null,
        pendingUntil: null,
      })
  }
  for (const entry of result) {
    const link = links.find((l) => keyOf(l.organizationId) === entry.bot)
    if (!link) continue
    entry.linkedAt = link.linkedAt
    entry.pendingUntil =
      link.linkCodeExpiresAt !== null && link.linkCodeExpiresAt > now
        ? link.linkCodeExpiresAt
        : null
  }
  return result
}

const unknownBot = () => new DomainError('NOT_FOUND', 'Questo bot non ti scrive')

/** A scope where the person's link with that bot is seen and written. */
const scopeOf = (userId: string, owner: TelegramBotOwner) =>
  owner === null ? { userId } : { organizationId: owner, userId }

/**
 * A new code for the bot: the address the person opens to press «Avvia». An earlier code of the
 * same bot stops working; a chat already linked stays until the new `/start`.
 */
export async function startTelegramLink(
  deps: TelegramLinkDeps,
  userId: string,
  bot: TelegramBotKey,
): Promise<{ url: string; expiresAt: Date }> {
  const found = (await listTelegramLinks(deps, userId)).find((l) => l.bot === bot)
  if (!found) throw unknownBot()
  const owner = ownerOf(bot)
  const { token: code, hash } = deps.tokens.generate()
  const expiresAt = new Date(deps.clock.now().getTime() + LINK_CODE_MINUTES * 60_000)
  await deps.uow.run(scopeOf(userId, owner), (tx) =>
    tx.telegramLinks.startLink({
      organizationId: owner,
      userId,
      codeHash: hash.toString('hex'),
      expiresAt,
    }),
  )
  const url = new URL(`https://t.me/${found.botUsername}`)
  url.searchParams.set('start', code)
  return { url: url.toString(), expiresAt }
}

/** The person's chat with the bot goes: nothing more arrives there. Nothing linked: nothing done. */
export async function unlinkTelegram(
  deps: Pick<TelegramLinkDeps, 'uow'>,
  userId: string,
  bot: TelegramBotKey,
): Promise<void> {
  if (bot !== 'platform' && !isUuid(bot)) throw unknownBot()
  const owner = ownerOf(bot)
  await deps.uow.run(scopeOf(userId, owner), (tx) => tx.telegramLinks.deleteFor(owner, userId))
}

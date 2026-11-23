import { DomainError } from '@app/domain'
import { assertRecentReauth } from '../identity/index.js'
import type { AuthSessionInfo } from '../ports/auth.js'
import type { Clock } from '../ports/clock.js'
import type { IntegrationStore } from '../ports/integration-store.js'
import type { TelegramBotApi } from '../ports/telegram-bot-api.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { telegramBotView, verifyBotToken, type TelegramBotView } from '../notifications/index.js'
import {
  assertPlatform,
  callerIsSystem,
  NO_REQUEST,
  platformAuthor,
  type PlatformCaller,
  type PlatformRequest,
} from './platform-actor.js'

// Piattaforma → Integrazioni → Telegram (plan 08 Scelta 8): the platform's bot, the one every
// agency uses unless it set its own. Its row is the platform's, visible only in the system scope.

export interface PlatformTelegramBotDeps {
  uow: UnitOfWork
  clock: Clock
  integrations: IntegrationStore
  telegram: Pick<TelegramBotApi, 'getMe'>
}

/** A panel request also carries its session: a change needs a recent reauth. */
export interface PlatformBotRequest extends PlatformRequest {
  session: AuthSessionInfo | null
}

const FROM_CLI: PlatformBotRequest = { ...NO_REQUEST, session: null }
const ENTITY = 'integration'

function assertPanelReauth(clock: Clock, caller: PlatformCaller, request: PlatformBotRequest) {
  if (callerIsSystem(caller)) return
  if (request.session === null)
    throw new DomainError('REAUTH_REQUIRED', 'Conferma la tua identità per continuare')
  if (request.session.userId !== caller.userId)
    throw new DomainError('FORBIDDEN', 'Solo l’amministratore della piattaforma può farlo')
  assertRecentReauth(request.session, clock.now())
}

/** The platform's bot as the administrator sees it; null while there is none. */
export async function getPlatformTelegramBot(
  deps: Pick<PlatformTelegramBotDeps, 'uow' | 'integrations'>,
  caller: PlatformCaller,
  request: PlatformRequest = NO_REQUEST,
): Promise<TelegramBotView | null> {
  assertPlatform(caller, 'platform.integrations.manage')
  return deps.uow.runAsSystem('platform: read the Telegram bot', async (tx) => {
    await platformAuthor(tx, caller, request)
    const found = await deps.integrations.getPlatform(tx, 'telegram')
    return found === null ? null : telegramBotView(found)
  })
}

/**
 * Sets the platform's bot: the token is tried with `getMe` first and saved only if Telegram
 * accepts it, the name comes from Telegram. The activity entry names the bot, never the token.
 */
export async function replacePlatformTelegramBot(
  deps: PlatformTelegramBotDeps,
  caller: PlatformCaller,
  input: { token: string },
  request: PlatformBotRequest = FROM_CLI,
): Promise<TelegramBotView> {
  assertPlatform(caller, 'platform.integrations.manage')
  assertPanelReauth(deps.clock, caller, request)
  // the role is read again before Telegram is called: a demoted administrator calls nothing
  await deps.uow.runAsSystem('platform: Telegram bot before a change', (tx) =>
    platformAuthor(tx, caller, request),
  )
  const { token, botId, botUsername } = await verifyBotToken(deps.telegram, input.token)
  const verifiedAt = deps.clock.now()
  return deps.uow.runAsSystem('platform: change the Telegram bot', async (tx) => {
    const author = await platformAuthor(tx, caller, request)
    const view = await deps.integrations.replacePlatform(tx, 'telegram', {
      config: { botId, botUsername },
      secret: token,
      updatedBy: author.actorId,
    })
    // tried a moment ago: the row is marked as the version that was saved
    await tx.integrations.markPlatformVerified('telegram', verifiedAt, view.updatedAt)
    await tx.audit.record({
      organizationId: null,
      actorId: author.actorId,
      source: author.source,
      action: 'platform.telegram_bot_changed',
      entity: ENTITY,
      entityId: null,
      workspaceId: null,
      ip: author.ip,
      data: { botUsername },
    })
    return telegramBotView({ ...view, verifiedAt, rejectedAt: null })
  })
}

/** Takes the platform's bot away: who has no agency bot gets nothing on Telegram. */
export async function removePlatformTelegramBot(
  deps: Pick<PlatformTelegramBotDeps, 'uow' | 'clock' | 'integrations'>,
  caller: PlatformCaller,
  request: PlatformBotRequest = FROM_CLI,
): Promise<void> {
  assertPlatform(caller, 'platform.integrations.manage')
  assertPanelReauth(deps.clock, caller, request)
  await deps.uow.runAsSystem('platform: remove the Telegram bot', async (tx) => {
    const author = await platformAuthor(tx, caller, request)
    const found = await deps.integrations.getPlatform(tx, 'telegram')
    if (found === null || !(await tx.integrations.deletePlatform('telegram'))) return
    await tx.audit.record({
      organizationId: null,
      actorId: author.actorId,
      source: author.source,
      action: 'platform.telegram_bot_removed',
      entity: ENTITY,
      entityId: null,
      workspaceId: null,
      ip: author.ip,
      data: { botUsername: found.config.botUsername },
    })
  })
}

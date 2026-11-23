import { can, DomainError, type OrgActor } from '@app/domain'
import { assertRecentReauth } from '../identity/index.js'
import type { AuthSessionInfo } from '../ports/auth.js'
import type { Clock } from '../ports/clock.js'
import type { IntegrationStore } from '../ports/integration-store.js'
import type { TelegramBotApi } from '../ports/telegram-bot-api.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { telegramBotView, verifyBotToken, type TelegramBotView } from './telegram-token.js'

// Impostazioni → Integrazioni → Telegram (plan 08 Scelta 8): an agency may use a bot of its own
// instead of the platform's; then its members link again to that bot. Telegram is never called
// inside a transaction: read, call, then write over what was read (as Meta's app).

export interface AgencyTelegramBotDeps {
  uow: UnitOfWork
  clock: Clock
  integrations: IntegrationStore
  telegram: Pick<TelegramBotApi, 'getMe'>
}

const ENTITY = 'integration'

const cannotView = () =>
  new DomainError('FORBIDDEN', 'Non hai i permessi per vedere le integrazioni')
const cannotManage = () =>
  new DomainError('FORBIDDEN', 'Solo l’Owner può cambiare le integrazioni dell’agenzia')

/** The role read again inside the transaction: a change since the actor was resolved counts. */
async function assertStillManages(tx: Tx, actor: OrgActor): Promise<void> {
  const { organizationId } = actor
  const membership = await tx.orgMembers.find(organizationId, actor.userId)
  if (
    membership?.status !== 'active' ||
    !can({ ...actor, orgRole: membership.role }, 'organization.settings.manage', {
      organizationId,
    })
  )
    throw cannotManage()
}

function assertManager(actor: OrgActor, session: AuthSessionInfo, clock: Clock): void {
  if (session.userId !== actor.userId)
    throw new DomainError('UNAUTHENTICATED', 'Sessione scaduta: accedi di nuovo')
  const { organizationId } = actor
  if (!can(actor, 'organization.settings.manage', { organizationId })) throw cannotManage()
  assertRecentReauth(session, clock.now())
}

/** Owner, and Admin read only (spec §10.2); null: the agency uses the platform's bot. */
export async function getAgencyTelegramBot(
  deps: Pick<AgencyTelegramBotDeps, 'uow' | 'integrations'>,
  actor: OrgActor,
): Promise<TelegramBotView | null> {
  const { organizationId } = actor
  if (!can(actor, 'organization.settings.view', { organizationId })) throw cannotView()
  const found = await deps.uow.run({ organizationId, userId: actor.userId }, (tx) =>
    deps.integrations.get(tx, organizationId, 'telegram'),
  )
  return found === null ? null : telegramBotView(found)
}

/**
 * Sets the agency's own bot (Owner, with a recent reauth). The token is tried with `getMe`
 * first and saved only if Telegram accepts it; the name comes from Telegram. The activity entry
 * names the bot, never the token.
 */
export async function replaceAgencyTelegramBot(
  deps: AgencyTelegramBotDeps,
  actor: OrgActor,
  session: AuthSessionInfo,
  input: { token: string },
  request: { ip: string | null },
): Promise<TelegramBotView> {
  assertManager(actor, session, deps.clock)
  const { organizationId, userId } = actor
  const scope = { organizationId, userId }
  const read = await deps.uow.run(scope, async (tx) => {
    await assertStillManages(tx, actor)
    return deps.integrations.get(tx, organizationId, 'telegram')
  })
  const { token, botUsername } = await verifyBotToken(deps.telegram, input.token)
  const verifiedAt = deps.clock.now()
  return deps.uow.run(scope, async (tx) => {
    await assertStillManages(tx, actor)
    const view = await deps.integrations.replace(tx, organizationId, 'telegram', {
      config: { botUsername },
      secret: token,
      updatedBy: userId,
      expectedVersion: read?.updatedAt ?? null,
      verifiedAt,
    })
    if (view === null)
      throw new DomainError('CONFLICT', 'Il bot di Telegram è cambiato nel frattempo')
    await tx.audit.record({
      organizationId,
      actorId: userId,
      source: 'panel',
      action: 'integration.telegram_changed',
      entity: ENTITY,
      entityId: null,
      workspaceId: null,
      ip: request.ip,
      data: { botUsername },
    })
    return telegramBotView(view)
  })
}

/**
 * Back to the platform's bot (Owner, with a recent reauth): the agency's bot is forgotten, and
 * its members link again to the platform's. Nothing set: nothing to do.
 */
export async function removeAgencyTelegramBot(
  deps: Pick<AgencyTelegramBotDeps, 'uow' | 'clock' | 'integrations'>,
  actor: OrgActor,
  session: AuthSessionInfo,
  request: { ip: string | null },
): Promise<void> {
  assertManager(actor, session, deps.clock)
  const { organizationId, userId } = actor
  await deps.uow.run({ organizationId, userId }, async (tx) => {
    await assertStillManages(tx, actor)
    const found = await deps.integrations.get(tx, organizationId, 'telegram')
    if (found === null) return
    if (!(await tx.integrations.deleteForOrganization(organizationId, 'telegram', found.updatedAt)))
      throw new DomainError('CONFLICT', 'Il bot di Telegram è cambiato nel frattempo')
    await tx.audit.record({
      organizationId,
      actorId: userId,
      source: 'panel',
      action: 'integration.telegram_removed',
      entity: ENTITY,
      entityId: null,
      workspaceId: null,
      ip: request.ip,
      data: { botUsername: found.config.botUsername },
    })
  })
}

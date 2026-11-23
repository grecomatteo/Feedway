import {
  can,
  groupListing,
  type OrgActor,
  type OutboxEventType,
  type OutboxPayload,
} from '@app/domain'
import type { DigestBlock, DigestContext, DigestSection } from '../module-definition.js'
import type { Tx } from '../ports/tx.js'
import { currentActor } from '../workspaces/index.js'
import { lineOf } from './notification-messages.js'
import { metaReminderEvent, readMetaReminders } from './reminders.js'

// The accounts' section of the morning digest (§12.4, plan 08 Task 8): the connections that stopped
// working, the accounts that cannot publish or need a look, and the Meta reminders, with the
// same words as their notifications. For Owner and Admin only, as those notifications
// (Scelta 4); read now in the person's scope.

const actorOf = (ctx: DigestContext): OrgActor => ({
  userId: ctx.userId,
  platformRole: null,
  organizationId: ctx.organizationId,
  orgRole: 'member',
  memberships: new Map(),
})

async function attention(tx: Tx, ctx: DigestContext): Promise<DigestBlock | null> {
  const { organizationId } = ctx
  const current = await currentActor(tx, actorOf(ctx))
  if (!can(current, 'accounts.manage', { organizationId })) return null
  const message = {
    tx,
    organizationId,
    userId: ctx.userId,
    t: ctx.t,
    panelUrl: ctx.panelUrl,
    timeZone: ctx.timeZone,
  }
  const line = async (type: OutboxEventType, payload: OutboxPayload) =>
    (
      await lineOf(type, message, {
        eventId: '',
        type,
        payload,
        workspaceId: null,
        createdAt: ctx.now,
      })
    )?.line ?? null
  const lines: string[] = []
  const connections = await tx.connections.list(organizationId)
  const ended = new Set<string>()
  for (const c of connections)
    if (c.status === 'expired' || c.status === 'revoked') {
      ended.add(c.id)
      const told = await line('account.token_invalid', { connectionId: c.id, status: c.status })
      if (told !== null) lines.push(told)
    }
  // an account of a connection that stopped is told by its connection
  for (const a of await tx.accounts.list(organizationId))
    if (
      a.active &&
      !ended.has(a.connectionId) &&
      (a.health === 'error' || a.health === 'warning')
    ) {
      const told = await line('account.unhealthy', { accountId: a.id, health: a.health })
      if (told !== null) lines.push(told)
    }
  const { reminders, appRejectedAt } = await readMetaReminders(
    tx,
    ctx.metaReminders,
    organizationId,
    ctx.now,
  )
  for (const reminder of reminders) {
    const event = metaReminderEvent(organizationId, reminder, appRejectedAt)
    if (!event) continue
    const told = await line('meta.reminder', event.payload)
    if (told !== null) lines.push(told)
  }
  if (lines.length === 0) return null
  const { shown, more } = groupListing(lines)
  return {
    title:
      lines.length === 1
        ? ctx.t('digest.accounts.one')
        : ctx.t('digest.accounts.many', { n: String(lines.length) }),
    lines: shown,
    more,
  }
}

/** After the posts and the plans of stage 9 (§12.4). */
export const accountsDigestSections: readonly DigestSection[] = [
  { id: 'accounts.attention', order: 50, build: attention },
]

import type { NotificationKindRule } from '@app/domain'
import { dayAndTime } from '../mail/index.js'
import type { NotificationKind } from '../module-definition.js'
import {
  asString,
  contextLine,
  groupedMessage,
  kindKey,
  panelLink,
  placeOf,
  type MessageContext,
  type NotifiedEvent,
} from '../notifications/index.js'

// The words of the accounts' notifications (§12.2, plan 08 P3), read now in the recipient's
// scope: an account or a connection removed since is left out of the message.

/** A calendar date (YYYY-MM-DD) or an instant, as the emails write a day: «giovedì 3 dicembre». */
function dayOf(ctx: MessageContext, value: unknown): string {
  const raw = asString(value)
  if (raw === null) return ''
  const at = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00Z`) : new Date(raw)
  return dayAndTime(at, ctx.timeZone, { year: true }).day
}

async function accountName(ctx: MessageContext, event: NotifiedEvent): Promise<string | null> {
  const id = asString(event.payload.accountId)
  if (id === null || ctx.organizationId === null) return null
  return (await ctx.tx.accounts.findById(ctx.organizationId, id))?.name ?? null
}

/** One line per event, or null when what it was about is gone. */
async function lineOf(
  type: NotificationKindRule['type'],
  ctx: MessageContext,
  event: NotifiedEvent,
): Promise<{ line: string; name: string } | null> {
  const { t } = ctx
  const { payload } = event
  switch (type) {
    case 'account.quota_low': {
      const name = await accountName(ctx, event)
      if (name === null) return null
      const line = t(kindKey(type, 'line'), {
        account: name,
        left: String(payload.left ?? 0),
        total: String(payload.total ?? 0),
      })
      return { line, name }
    }
    case 'account.unhealthy': {
      const name = await accountName(ctx, event)
      if (name === null) return null
      const health = payload.health === 'warning' ? 'warning' : 'error'
      return { line: t(kindKey(type, health), { account: name }), name }
    }
    case 'account.token_invalid': {
      const id = asString(payload.connectionId)
      if (id === null || ctx.organizationId === null) return null
      const connection = await ctx.tx.connections.findById(ctx.organizationId, id)
      if (!connection) return null
      const name = connection.businessName ?? t(kindKey(type, 'unnamed'))
      const status = payload.status === 'revoked' ? 'revoked' : 'expired'
      return { line: t(kindKey(type, status), { connection: name }), name }
    }
    case 'meta.reminder': {
      const reminder = asString(payload.reminder)
      switch (reminder) {
        case 'app_rejected':
          return { line: t(kindKey(type, reminder)), name: '' }
        case 'graph_version_sunset':
          return {
            line: t(kindKey(type, reminder), {
              version: asString(payload.version) ?? '',
              date: dayOf(ctx, payload.dueOn),
            }),
            name: '',
          }
        case 'data_use_checkup':
          return { line: t(kindKey(type, reminder), { date: dayOf(ctx, payload.dueOn) }), name: '' }
        case 'token_expiring':
          return {
            line: t(kindKey(type, reminder), { date: dayOf(ctx, payload.expiresAt) }),
            name: '',
          }
        default:
          return null
      }
    }
    default:
      throw new Error(`not an accounts event: ${type}`)
  }
}

async function accountsMessage(
  rule: NotificationKindRule,
  ctx: MessageContext,
  events: readonly NotifiedEvent[],
) {
  const place = await placeOf(ctx, [])
  if (!place) return null
  const told = (await Promise.all(events.map((e) => lineOf(rule.type, ctx, e)))).filter(
    (x) => x !== null,
  )
  if (told.length === 0) return null
  const toMeta = rule.type === 'account.token_invalid' || rule.type === 'meta.reminder'
  const link = toMeta
    ? {
        label: ctx.t('notify.open.meta'),
        url: panelLink(ctx, place.slug, 'impostazioni', 'integrazioni', 'meta'),
      }
    : { label: ctx.t('notify.open.accounts'), url: panelLink(ctx, place.slug, 'account') }
  return groupedMessage({
    t: ctx.t,
    type: rule.type,
    level: rule.level,
    one: { account: told[0]?.name ?? '' },
    lines: told.map((x) => x.line),
    context: contextLine(ctx.t, place),
    link,
  })
}

/** A kind of the accounts, with its words. */
export const accountKind = (rule: NotificationKindRule): NotificationKind => ({
  ...rule,
  message: (ctx, events) => accountsMessage(rule, ctx, events),
})

import type { NotificationKindRule } from '@app/domain'
import type { NotificationKind } from '../module-definition.js'
import { groupedMessage, kindKey, panelLink } from '../notifications/index.js'

/** A kind of the platform (§12.2): a fixed sentence, and the platform's pages. */
export const platformKind = (rule: NotificationKindRule): NotificationKind => ({
  ...rule,
  message: (ctx, events) =>
    Promise.resolve(
      groupedMessage({
        t: ctx.t,
        type: rule.type,
        level: rule.level,
        one: {},
        lines: events.map(() => ctx.t(kindKey(rule.type, 'line'))),
        context: null,
        link: { label: ctx.t('notify.open.platform'), url: panelLink(ctx) },
      }),
    ),
})

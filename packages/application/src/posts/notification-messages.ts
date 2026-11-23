import type { NotificationKindRule, Platform } from '@app/domain'
import type { NotificationKind } from '../module-definition.js'
import {
  asString,
  contextLine,
  groupedMessage,
  kindKey,
  panelLink,
  placeOf,
  platformName,
  type MessageContext,
  type NotifiedEvent,
} from '../notifications/index.js'

// The words of the publishing's notifications (§12.2, plan 08 P3): read now, in the recipient's
// scope. A post deleted since gives a short line without its text.

/** The start of the post's text, for a line: its first line, at most this long. */
const HEADLINE_MAX = 60

export function postHeadline(caption: string): string | null {
  const first = caption.trim().split(/\r?\n/, 1)[0]?.trim() ?? ''
  if (first === '') return null
  return first.length <= HEADLINE_MAX ? first : `${first.slice(0, HEADLINE_MAX - 1).trimEnd()}…`
}

interface Told {
  postId: string | null
  /** null: the post is gone */
  headline: string | null
  account: { name: string; platform: Platform } | null
  line: string
}

/** Why the destination did not go out as planned, from the codes of the event. */
function whyOf(
  ctx: MessageContext,
  event: NotifiedEvent,
  platform: Platform | null,
): string | null {
  // a file that will not go out carries the rule's code, which its own sentence covers
  const code =
    event.type === 'post.file_wont_publish'
      ? 'file_wont_publish'
      : (asString(event.payload.code) ?? asString(event.payload.reason))
  if (code === null) return null
  const values = { platform: platform === null ? 'Meta' : platformName(ctx.t, platform) }
  try {
    return ctx.t(`today.issues.post.reason.${code}`, values)
  } catch {
    // a code newer than the texts: the generic one, the page says the rest
    return ctx.t('today.issues.post.reason.other', values)
  }
}

async function tell(ctx: MessageContext, event: NotifiedEvent): Promise<Told> {
  const { tx, organizationId, t } = ctx
  const postId = asString(event.payload.postId)
  const accountId = asString(event.payload.accountId)
  if (organizationId === null) throw new Error('a post event without an agency')
  const post =
    postId && event.workspaceId
      ? await tx.posts.find({ organizationId, workspaceId: event.workspaceId }, postId)
      : null
  const account = accountId ? await tx.accounts.findById(organizationId, accountId) : null
  if (!post) return { postId: null, headline: null, account, line: t('notify.post.gone') }
  const headline = postHeadline(post.caption) ?? t('notify.post.noText')
  if (!account) return { postId, headline, account: null, line: `«${headline}»` }
  const why = event.type === 'post.confirmed' ? null : whyOf(ctx, event, account.platform)
  const values = { account: account.name, post: headline }
  const line =
    why === null
      ? t('notify.post.line', values)
      : t('notify.post.lineWhy', { ...values, why: why.replace(/^./, (c) => c.toUpperCase()) })
  return { postId, headline, account, line }
}

async function postsMessage(
  rule: NotificationKindRule,
  ctx: MessageContext,
  events: readonly NotifiedEvent[],
) {
  const place = await placeOf(ctx, events)
  if (!place) return null
  const told = await Promise.all(events.map((e) => tell(ctx, e)))
  const lines = told.map((x) => x.line)
  // a post that will not go out says when (D-74): before its time, or at it
  const [first] = events
  const note =
    rule.type === 'post.file_wont_publish' && events.length === 1 && first
      ? ctx.t(kindKey(rule.type, first.payload.when === 'before' ? 'before' : 'at'))
      : null
  const posts = new Set(told.map((x) => x.postId))
  const [onlyPost] = posts
  const link =
    posts.size === 1 && typeof onlyPost === 'string' && place.workspace
      ? {
          label: ctx.t('notify.post.open'),
          url: panelLink(ctx, place.slug, 'spazi', place.workspace.slug, 'post', onlyPost),
        }
      : place.workspace
        ? {
            label: ctx.t('notify.post.openList'),
            url: panelLink(ctx, place.slug, 'spazi', place.workspace.slug, 'post'),
          }
        : { label: ctx.t('notify.post.openToday'), url: panelLink(ctx, place.slug) }
  return groupedMessage({
    t: ctx.t,
    type: rule.type,
    level: rule.level,
    one: { account: told[0]?.account?.name ?? ctx.t('notify.post.someAccount') },
    lines,
    note,
    context: contextLine(ctx.t, place),
    link,
  })
}

/** A kind of the publishing, with its words. */
export const postKind = (rule: NotificationKindRule): NotificationKind => ({
  ...rule,
  message: (ctx, events) => postsMessage(rule, ctx, events),
})

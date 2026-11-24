import {
  groupListing,
  instantToZoned,
  zonedToInstant,
  type OrgActor,
  type PublishingPostStatus,
} from '@app/domain'
import { timeOfDay } from '../mail/index.js'
import type { DigestBlock, DigestContext, DigestSection } from '../module-definition.js'
import type { Tx } from '../ports/tx.js'
import { clientsOf, postIssuesOf } from './agenda.js'
import { platformName } from '../notifications/index.js'
import { postTitles } from './notification-messages.js'

// The posts' sections of the morning digest (§12.4, plan 08 Task 8): what went out yesterday,
// what needs a hand, what goes out today, across the clients the person sees in the agency, as
// «Oggi» reads them. «Ieri» and «oggi» are the agency's days (D-58). Read in the person's scope.

/** More posts than a digest lists: the section says how many, the panel shows them. */
const DIGEST_POSTS_MAX = 200

const DAY_MS = 86_400_000

function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10)
}

/** The start of a local day, as an instant. */
const startOf = (localDate: string, timeZone: string) =>
  zonedToInstant(localDate, '00:00', timeZone).instant

/** The person as an actor of the agency: `clientsOf` reads the role and the clients again. */
const actorOf = (ctx: DigestContext): OrgActor => ({
  userId: ctx.userId,
  platformRole: null,
  organizationId: ctx.organizationId,
  orgRole: 'member',
  memberships: new Map(),
})

async function visibleClients(tx: Tx, ctx: DigestContext) {
  const { current, ids } = await clientsOf(tx, actorOf(ctx), undefined)
  const names = new Map(
    (await tx.workspaces.listVisible(current)).map((w) => [w.id, w.name] as const),
  )
  return { current, ids, name: (id: string) => names.get(id) ?? '' }
}

/** The title for one or for many, as the notifications' (`digest.posts.<part>.one|many`). */
function block(ctx: DigestContext, part: string, lines: readonly string[]): DigestBlock | null {
  if (lines.length === 0) return null
  const { shown, more } = groupListing(lines)
  const title =
    lines.length === 1
      ? ctx.t(`digest.posts.${part}.one`)
      : ctx.t(`digest.posts.${part}.many`, { n: String(lines.length) })
  return { title, lines: shown, more }
}

/** The posts in a period, a line each: «18:00 · Forno Luce · «Pane caldo»». */
async function postsIn(
  tx: Tx,
  ctx: DigestContext,
  period: { from: Date; to: Date },
  statuses: readonly PublishingPostStatus[],
): Promise<string[]> {
  const clients = await visibleClients(tx, ctx)
  if (clients.ids.length === 0) return []
  const records = await tx.posts.listInPeriod(ctx.organizationId, clients.ids, {
    ...period,
    statuses,
    limit: DIGEST_POSTS_MAX,
  })
  const titleOf = postTitles(tx, ctx.t, clients.current)
  // a post out says when it went out, not when it was due: after «Riprova» they differ (D-131.5)
  const outAt = new Map<string, Date>()
  if (statuses.includes('published'))
    for (const t of await tx.publishing.targetsOfPosts(
      ctx.organizationId,
      records.map((p) => p.id),
    ))
      if (t.publishedAt !== null && t.publishedAt > (outAt.get(t.postId) ?? new Date(0)))
        outAt.set(t.postId, t.publishedAt)
  const lines: { at: Date; line: string }[] = []
  for (const p of records) {
    const at = outAt.get(p.id) ?? p.scheduledAt
    if (at !== null)
      lines.push({
        at,
        line: ctx.t('digest.posts.line', {
          time: timeOfDay(at, ctx.timeZone),
          client: clients.name(p.workspaceId),
          post: await titleOf(p),
        }),
      })
  }
  return lines.sort((a, b) => a.at.getTime() - b.at.getTime()).map((l) => l.line)
}

/** Confirmed yesterday, in the agency's day. */
async function yesterday(tx: Tx, ctx: DigestContext): Promise<DigestBlock | null> {
  const today = instantToZoned(ctx.now, ctx.timeZone).localDate
  const lines = await postsIn(
    tx,
    ctx,
    { from: startOf(addDays(today, -1), ctx.timeZone), to: startOf(today, ctx.timeZone) },
    ['published'],
  )
  return block(ctx, 'yesterday', lines)
}

/** From now to the end of the agency's day. */
async function today(tx: Tx, ctx: DigestContext): Promise<DigestBlock | null> {
  const date = instantToZoned(ctx.now, ctx.timeZone).localDate
  const lines = await postsIn(
    tx,
    ctx,
    { from: ctx.now, to: startOf(addDays(date, 1), ctx.timeZone) },
    ['scheduled', 'publishing'],
  )
  return block(ctx, 'today', lines)
}

/** The open problems of «Da sistemare»: not out, then paused or with a problem. */
async function issues(tx: Tx, ctx: DigestContext): Promise<DigestBlock | null> {
  const clients = await visibleClients(tx, ctx)
  if (clients.ids.length === 0) return null
  const found = await postIssuesOf(tx, clients.current, clients.ids)
  const { shown, more } = groupListing(found)
  const titleOf = postTitles(tx, ctx.t, clients.current)
  const lines: string[] = []
  for (const issue of shown) {
    const post = await tx.posts.find(
      { organizationId: ctx.organizationId, workspaceId: issue.workspaceId },
      issue.postId,
    )
    if (!post) continue
    const state = ctx.t(`digest.posts.issue.${issue.status}`)
    let why: string | null = null
    if (issue.reason !== null)
      try {
        why = ctx.t(`today.issues.post.reason.${issue.reason}`, {
          platform:
            issue.platforms.length === 1 && issue.platforms[0]
              ? platformName(ctx.t, issue.platforms[0])
              : 'Meta',
        })
      } catch {
        // a code newer than the texts: the state alone, the post says the rest
      }
    lines.push(
      ctx.t(why === null ? 'digest.posts.issue.line' : 'digest.posts.issue.lineWhy', {
        client: clients.name(issue.workspaceId),
        post: await titleOf(post),
        state,
        ...(why === null ? {} : { why }),
      }),
    )
  }
  if (lines.length === 0) return null
  const total = lines.length + more
  return {
    title:
      total === 1
        ? ctx.t('digest.posts.issues.one')
        : ctx.t('digest.posts.issues.many', { n: String(total) }),
    lines,
    more,
  }
}

/** In the order of §12.4; the plans of stage 9 go between today and the accounts. */
export const postsDigestSections: readonly DigestSection[] = [
  { id: 'posts.yesterday', order: 10, build: yesterday },
  { id: 'posts.issues', order: 20, build: issues },
  { id: 'posts.today', order: 30, build: today },
]

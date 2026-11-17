import {
  DomainError,
  can,
  evaluatePost,
  resolveWhen,
  type DraftMedia,
  type MediaKind,
  type OrgActor,
  type Platform,
  type PlatformRules,
  type PostCaption,
  type PostDraft,
  type PostType,
  type PostWhen,
  type RuleChoice,
  type RuleReport,
} from '@app/domain'
import { getAccountsForRules } from '../accounts/index.js'
import { isUuid } from '../identity/index.js'
import { getMediaForRules } from '../media/index.js'
import type { Clock } from '../ports/clock.js'
import type { PublishingHistory } from '../ports/publishing-history.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { currentActor, workspaceNotFound } from '../workspaces/index.js'

// The checks before scheduling on the workspace's own data (plan 05 Task 2, R3). A read: it
// writes nothing and leaves nothing in the activity log. The editor of stage 6 calls it while
// the post is written and when it is saved, the worker of stage 7 before it publishes.

/** The time zone of the posts (general plan §4): every date of a post is Rome's. */
export const POST_TIME_ZONE = 'Europe/Rome'

export interface CheckPostDeps {
  uow: UnitOfWork
  clock: Clock
  /** from the composition root (ADR 019, plan 05 R2) */
  platformRules: ReadonlyMap<Platform, PlatformRules>
  publishingHistory: PublishingHistory
}

/** A post as the editor holds it: files and accounts by id, in the order of the post. */
export interface PostCheckInput {
  workspaceId: string
  type: PostType
  mediaIds: readonly string[]
  cover?: { source: 'frame'; offsetMs: number } | { source: 'image'; mediaId: string }
  caption: PostCaption
  destinations: readonly { accountId: string }[]
  when: PostWhen
  /** a reel also in the feed (§9.1) */
  shareToFeed: boolean
  choices: readonly RuleChoice[]
}

/**
 * A file that is not the workspace's (deleted, of another workspace or agency, or no such
 * id): the rules say «non disponibile» and nothing else of it. Its kind is the one the post
 * expects, so no other block follows from a kind nobody knows.
 */
const unavailable = (mediaId: string, kind: MediaKind): DraftMedia => ({
  mediaId,
  status: 'deleted',
  kind,
  analysis: null,
  checks: null,
  failure: null,
  sha256: null,
})

/**
 * Editor and above (`post.draft`, spec §10.2); for anyone else, the Viewer included, the
 * workspace does not exist (404).
 */
export async function checkPost(
  deps: CheckPostDeps,
  actor: OrgActor,
  input: PostCheckInput,
): Promise<RuleReport> {
  const { organizationId } = actor
  if (!isUuid(input.workspaceId)) throw workspaceNotFound()
  const now = deps.clock.now()
  // an impossible date (30 February) is refused before anything is read
  const at = resolveWhen(input.when, now, POST_TIME_ZONE).instant
  const accountIds = input.destinations.map((d) => d.accountId)
  const coverId = input.cover?.source === 'image' ? input.cover.mediaId : null

  const read = await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const current = await currentActor(tx, actor)
    const workspace = await tx.workspaces.findVisibleById(current, input.workspaceId)
    if (
      !workspace ||
      !can(current, 'post.draft', { organizationId, workspaceId: input.workspaceId })
    )
      throw workspaceNotFound()
    // nothing goes out of an archived client: the worker of stage 7 checks again with this
    if (workspace.archivedAt !== null)
      throw new DomainError('CONFLICT', 'Il cliente è archiviato: non si programmano post')
    const scope = { organizationId, workspaceId: workspace.id }
    const media = await getMediaForRules(tx, scope, [
      ...input.mediaIds,
      ...(coverId ? [coverId] : []),
    ])
    const accounts = await getAccountsForRules(tx, scope, accountIds)
    const history = await deps.publishingHistory.forDestinations(tx, {
      organizationId,
      accountIds: [...accounts.keys()],
      at,
    })
    return { workspaceId: workspace.id, media, accounts, history }
  })

  const fileKind: MediaKind = input.type === 'reel' ? 'video' : 'image'
  // a file deleted from this workspace says no more than one of another agency
  const fileOf = (id: string, kind: MediaKind) => {
    const found = read.media.get(id)
    return found && found.status !== 'deleted' ? found : unavailable(id, kind)
  }
  const draft: PostDraft = {
    type: input.type,
    media: input.mediaIds.map((id) => fileOf(id, fileKind)),
    ...(input.cover === undefined
      ? {}
      : {
          cover:
            input.cover.source === 'image'
              ? { source: 'image', media: fileOf(input.cover.mediaId, 'image') }
              : input.cover,
        }),
    caption: input.caption,
    destinations: input.destinations.map((d) => ({ accountId: d.accountId })),
    when: input.when,
    shareToFeed: input.shareToFeed,
    choices: [...input.choices],
  }
  return evaluatePost(draft, {
    now,
    timeZone: POST_TIME_ZONE,
    workspaceId: read.workspaceId,
    accounts: read.accounts,
    history: read.history,
    platforms: deps.platformRules,
  })
}

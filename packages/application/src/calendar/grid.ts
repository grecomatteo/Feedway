import {
  DomainError,
  GRID_DAYS_AHEAD,
  GRID_PUBLISHED_LIMIT,
  isGridMediaId,
  sniffMedia,
  storedTimeZone,
  type OrgActor,
} from '@app/domain'
import { openGridAccount, recordGridLoad, type GridAccountView } from '../accounts/index.js'
import type { ConnectionTokens } from '../ports/connection-tokens.js'
import type { GridMedia, PlatformConnectors } from '../ports/platform-connector.js'
import {
  listGridPosts,
  sendAfterSchedule,
  swapScheduledTimes,
  type CalendarPostDto,
  type PostsDeps,
  type SwapSide,
} from '../posts/index.js'
import { currentActor, workspaceNotFound } from '../workspaces/index.js'
import type { Tx } from '../ports/tx.js'

// Instagram's grid (spec §11.5, plan 09 Task 12, P4): one Instagram account of a client, its
// scheduled posts of the next 30 days above the last 30 out. The posts out are read from the
// platform at every opening, outside any transaction, and never kept; their pictures pass
// through the server, which reads them again from the platform each time.

export interface GridDeps {
  uow: PostsDeps['uow']
  clock: PostsDeps['clock']
  connectors: PlatformConnectors
  connectionTokens: ConnectionTokens
}

/** A post out, as the panel draws it: never the platform's address of its picture. */
export interface GridPublishedDto {
  id: string
  kind: GridMedia['kind']
  reel: boolean
  publishedAt: string | null
  permalink: string | null
  hasPicture: boolean
}

export interface GridDto {
  account: Omit<GridAccountView, 'externalId'>
  timeZone: string
  /** latest first: the one furthest ahead is the first place of the grid */
  scheduled: CalendarPostDto[]
  /**
   * `unreachable`: the account's connection does not work now; `rejected`: the platform refused
   * the token; `unavailable`: no answer. The scheduled ones are shown all the same.
   */
  published:
    | { ok: true; items: GridPublishedDto[] }
    | { ok: false; reason: 'unreachable' | 'rejected' | 'unavailable' }
}

const accountNotFound = () => new DomainError('NOT_FOUND', 'Account non trovato')

const DAY_MS = 86_400_000

/** The client, visible to the person (the Viewer included), and its Instagram account. */
async function openGrid(
  tx: Tx,
  deps: GridDeps,
  actor: OrgActor,
  input: { workspaceId: string; accountId: string },
) {
  const current = await currentActor(tx, actor)
  const workspace = await tx.workspaces.findVisibleById(current, input.workspaceId)
  if (!workspace) throw workspaceNotFound()
  const scope = { organizationId: actor.organizationId, workspaceId: workspace.id }
  const opened = await openGridAccount(
    tx,
    { connectors: deps.connectors, tokens: deps.connectionTokens },
    scope,
    input.accountId,
  )
  if (!opened) throw accountNotFound()
  return { current, scope, opened }
}

const publishedDto = (m: GridMedia): GridPublishedDto => ({
  id: m.externalId,
  kind: m.kind,
  reel: m.reel,
  publishedAt: m.publishedAt?.toISOString() ?? null,
  permalink: m.permalink,
  hasPicture: m.pictureUrl !== null,
})

/**
 * The grid of an Instagram account of the client. The account and the posts are read in a
 * transaction; the platform is called after it, so no connection waits on Meta; what its
 * answer said of the limits is kept in a second one (D-111).
 */
export async function getGrid(
  deps: GridDeps,
  actor: OrgActor,
  input: { workspaceId: string; accountId: string },
): Promise<GridDto> {
  const scope0 = { organizationId: actor.organizationId, userId: actor.userId }
  const now = deps.clock.now()
  const read = await deps.uow.run(scope0, async (tx) => {
    const { current, scope, opened } = await openGrid(tx, deps, actor, input)
    const organization = await tx.organizations.findById(actor.organizationId)
    const timeZone = storedTimeZone(organization?.settings ?? {})
    const scheduled = await listGridPosts(tx, current, {
      workspaceId: scope.workspaceId,
      accountId: opened.account.id,
      period: { from: now, to: new Date(now.getTime() + GRID_DAYS_AHEAD * DAY_MS) },
      timeZone,
    })
    return { opened, timeZone, scheduled }
  })
  const { opened, timeZone, scheduled } = read
  const account = {
    id: opened.account.id,
    platform: opened.account.platform,
    name: opened.account.name,
    username: opened.account.username,
    avatarKey: opened.account.avatarKey,
  }
  if (!opened.reachable)
    return {
      account,
      timeZone,
      scheduled,
      published: { ok: false, reason: 'unreachable' },
    }
  const listing = await opened.connector.listGridMedia(
    opened.credentials,
    { platform: 'instagram', externalId: opened.account.externalId },
    { limit: GRID_PUBLISHED_LIMIT },
  )
  await keepLoad(deps, actor, opened.account.id, listing.load)
  return {
    account,
    timeZone,
    scheduled,
    published: listing.ok
      ? { ok: true, items: listing.media.map(publishedDto) }
      : { ok: false, reason: listing.reason },
  }
}

/** The limits an answer said, kept for the slowing down (§8.6). */
async function keepLoad(
  deps: GridDeps,
  actor: OrgActor,
  accountId: string,
  load: Parameters<typeof recordGridLoad>[3],
) {
  if (load === null) return
  await deps.uow.run({ organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
    recordGridLoad(tx, actor.organizationId, accountId, load, deps.clock.now()),
  )
}

/** The picture of a post out: its bytes and their type, judged by the bytes. */
export interface GridThumbnail {
  bytes: Buffer
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
}

/**
 * The picture of one post out of the grid, through the server (P4): the post must be among the
 * account's latest, the address is the one the platform gives for it now, only from the
 * platform's picture hosts, an image of at most 5 MB. null: nothing to show (404).
 */
export async function getGridThumbnail(
  deps: GridDeps,
  actor: OrgActor,
  input: { workspaceId: string; accountId: string; mediaId: string },
): Promise<GridThumbnail | null> {
  if (!isGridMediaId(input.mediaId)) return null
  const opened = await deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => (await openGrid(tx, deps, actor, input)).opened,
  )
  if (!opened.reachable) return null
  const read = await opened.connector.getGridMedia(
    opened.credentials,
    { platform: 'instagram', externalId: opened.account.externalId },
    input.mediaId,
    { limit: GRID_PUBLISHED_LIMIT },
  )
  await keepLoad(deps, actor, opened.account.id, read.load)
  if (!read.ok) {
    if (read.reason === 'unavailable') throw platformUnavailable()
    return null
  }
  if (read.media.pictureUrl === null) return null
  const download = await opened.connector.fetchPicture(read.media.pictureUrl)
  if (!download.ok) {
    if (download.reason === 'unavailable') throw platformUnavailable()
    return null
  }
  const type = sniffMedia(download.bytes)
  if (type?.kind !== 'image' || type.format === 'heic') return null
  return { bytes: download.bytes, contentType: type.mime as GridThumbnail['contentType'] }
}

const platformUnavailable = () =>
  new DomainError('PLATFORM_UNAVAILABLE', 'Instagram non risponde: riprova tra poco')

export interface GridSwapInput {
  workspaceId: string
  accountId: string
  a: SwapSide
  b: SwapSide
}

/**
 * Two scheduled posts of the grid swap their times (Scelta 10, P7): both or neither, with the
 * versions read; the publishing's jobs leave after the commit. «Annulla» is the same swap
 * again, with the versions this one gives back.
 */
export async function swapGridPosts(
  deps: PostsDeps,
  actor: OrgActor,
  input: GridSwapInput,
  request: { ip: string | null },
): Promise<{ posts: { id: string; version: number; scheduledAt: string }[] }> {
  const { posts, after } = await deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    (tx) =>
      swapScheduledTimes(tx, deps, actor, {
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        a: input.a,
        b: input.b,
        ip: request.ip,
      }),
  )
  for (const one of after) await sendAfterSchedule(deps, actor.organizationId, one)
  return { posts }
}

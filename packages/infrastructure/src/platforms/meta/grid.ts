import type {
  ConnectionCredentials,
  GridAccount,
  GridListing,
  GridMedia,
  GridMediaRead,
  MetaAppCredentials,
} from '@app/application'
import { MetaError, type MetaErrorReason } from './errors.js'
import type { MetaGraphClient, MetaGridMedia } from './graph-client.js'
import { loadOf } from './load.js'

// Instagram's grid (plan 09 Task 12, P4): the latest posts of the account's feed, read from
// Meta at every opening of the grid, never kept. The address of a picture is Meta's, and is
// downloaded only by the server (`fetchPicture`, Meta's picture hosts only).

/** The token, or what it may see, is refused: the grid says the posts out cannot be read. */
const REJECTED: ReadonlySet<MetaErrorReason> = new Set([
  'token_invalid',
  'token_revoked',
  'checkpoint',
  'page_role_missing',
  'permission_missing',
  'not_found_or_forbidden',
  'rejected',
])

const tokenOf = (credentials: ConnectionCredentials<MetaAppCredentials>) => ({
  accessToken: credentials.token,
  appSecret: credentials.app.appSecret,
})

const kindOf = (mediaType: string | null): GridMedia['kind'] =>
  mediaType === 'CAROUSEL_ALBUM' ? 'carousel' : mediaType === 'VIDEO' ? 'video' : 'image'

/**
 * A media as the grid shows it. A video's picture is its cover (`thumbnail_url`); an image's
 * and a carousel's is `media_url`, which for a carousel is its first file (not verified on
 * real Meta: a carousel without it shows no picture).
 */
export function gridMediaOf(m: MetaGridMedia): GridMedia {
  const kind = kindOf(m.mediaType)
  return {
    externalId: m.id,
    kind,
    reel: m.mediaProductType === 'REELS',
    publishedAt: m.timestamp,
    permalink: m.permalink,
    pictureUrl: (kind === 'video' ? m.thumbnailUrl : m.mediaUrl) ?? m.thumbnailUrl,
  }
}

/** A story never reaches the feed's edge; one that did would not stay in the grid. */
const inGrid = (m: MetaGridMedia) => m.mediaProductType !== 'STORY'

function failure(error: unknown) {
  if (!(error instanceof MetaError)) throw error
  return {
    ok: false as const,
    reason: REJECTED.has(error.reason) ? ('rejected' as const) : ('unavailable' as const),
    load: error.usage === null ? null : loadOf(error.usage),
  }
}

export async function listMetaGrid(
  client: Pick<MetaGraphClient, 'listInstagramGridMedia'>,
  credentials: ConnectionCredentials<MetaAppCredentials>,
  account: GridAccount,
  limit: number,
): Promise<GridListing> {
  if (account.platform !== 'instagram') return { ok: true, media: [], load: null }
  try {
    const { data, usage } = await client.listInstagramGridMedia(
      tokenOf(credentials),
      account.externalId,
      limit,
    )
    return { ok: true, media: data.filter(inGrid).map(gridMediaOf), load: loadOf(usage) }
  } catch (error) {
    return failure(error)
  }
}

/**
 * One media of the grid, from the same listing: a media's `owner` is given only to the app user
 * who made it (Meta's reference), so the only sure way to know it is this account's, among the
 * latest the grid shows, is to find it there. One call, as reading the media alone would be.
 */
export async function getMetaGridMedia(
  client: Pick<MetaGraphClient, 'listInstagramGridMedia'>,
  credentials: ConnectionCredentials<MetaAppCredentials>,
  account: GridAccount,
  mediaId: string,
  limit: number,
): Promise<GridMediaRead> {
  const listing = await listMetaGrid(client, credentials, account, limit)
  if (!listing.ok) return listing
  const media = listing.media.find((m) => m.externalId === mediaId)
  return media
    ? { ok: true, media, load: listing.load }
    : { ok: false, reason: 'not_found', load: listing.load }
}

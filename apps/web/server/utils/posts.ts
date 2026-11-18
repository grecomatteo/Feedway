import type { PostContent } from '@app/application'
import type { UpdatePostRequest } from '@app/contracts'

/**
 * The content of a post's body as the use cases take it: a field left out stays out
 * (`exactOptionalPropertyTypes`), so a save changes only what it sends.
 */
export function postContent(body: Omit<UpdatePostRequest, 'version'>): Partial<PostContent> {
  const { caption, choices, ...rest } = body
  const out: Partial<PostContent> = {}
  if (rest.type !== undefined) out.type = rest.type
  if (rest.mediaIds !== undefined) out.mediaIds = rest.mediaIds
  if (rest.cover !== undefined) out.cover = rest.cover
  if (rest.destinations !== undefined) out.destinations = rest.destinations
  if (rest.when !== undefined) out.when = rest.when
  if (rest.shareToFeed !== undefined) out.shareToFeed = rest.shareToFeed
  if (caption !== undefined)
    out.caption = {
      common: caption.common,
      ...(caption.instagram === undefined ? {} : { instagram: caption.instagram }),
      ...(caption.facebook === undefined ? {} : { facebook: caption.facebook }),
    }
  if (choices !== undefined)
    out.choices = choices.map(({ crop, ...c }) => (crop === undefined ? c : { ...c, crop }))
  return out
}

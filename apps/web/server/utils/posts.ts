import type { BulkRowInput, PostContent } from '@app/application'
import type { BulkRowBody, UpdatePostRequest } from '@app/contracts'

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
  if (rest.instagramCollaborators !== undefined)
    out.instagramCollaborators = rest.instagramCollaborators
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

/** The labels of a post's body, when it sends them: all of them, the others come off. */
export const postLabels = (body: Pick<UpdatePostRequest, 'labelIds'>) =>
  body.labelIds === undefined ? {} : { labelIds: body.labelIds }

/** One row of the table in bulk as the use case takes it: what it leaves out has its default. */
export function bulkRow(body: BulkRowBody): BulkRowInput {
  return {
    type: body.type,
    mediaIds: body.mediaIds,
    cover: body.cover ?? null,
    caption: {
      common: body.caption.common,
      ...(body.caption.instagram === undefined ? {} : { instagram: body.caption.instagram }),
      ...(body.caption.facebook === undefined ? {} : { facebook: body.caption.facebook }),
    },
    destinations: body.destinations,
    when: body.when,
    shareToFeed: body.shareToFeed ?? true,
    choices: (body.choices ?? []).map(({ crop, ...c }) =>
      crop === undefined ? c : { ...c, crop },
    ),
    labelIds: body.labelIds ?? [],
  }
}

import type { DraftMedia, PostType } from '../../../rules/types.js'

// What each type of post becomes on Instagram and on a Facebook Page (spec §9.1), as data: the
// destination summary says it, and the table of the cases (plan 05 Task 2) reads it.

export const INSTAGRAM_FORMATS = [
  'feed_photo',
  'carousel',
  'reel',
  'story_photo',
  'story_video',
] as const
export type InstagramFormat = (typeof INSTAGRAM_FORMATS)[number]

export const FACEBOOK_FORMATS = [
  'photo',
  'multi_photo',
  'reel',
  /** a reel of 90 s–15 min, after the choice «come video normale» */
  'video',
  'story_photo',
  'story_video',
] as const
export type FacebookFormat = (typeof FACEBOOK_FORMATS)[number]

/** §9.1, row by row; `warning`: when the row goes on Facebook only with a choice. */
export const CONTENT_TYPES = [
  { type: 'photo', instagram: 'feed_photo', facebook: 'photo' },
  { type: 'carousel', media: 'photos', instagram: 'carousel', facebook: 'multi_photo' },
  {
    type: 'carousel',
    media: 'mixed',
    instagram: 'carousel',
    facebook: 'multi_photo',
    warning: 'carousel_mixed_with_facebook',
  },
  { type: 'reel', duration: '3–90 s', instagram: 'reel', facebook: 'reel' },
  {
    type: 'reel',
    duration: '90 s–15 min',
    instagram: 'reel',
    facebook: 'reel',
    warning: 'reel_too_long_for_facebook',
  },
  { type: 'story', media: 'photo', instagram: 'story_photo', facebook: 'story_photo' },
  { type: 'story', media: 'video', instagram: 'story_video', facebook: 'story_video' },
] as const

const isStoryVideo = (media: readonly DraftMedia[]) => media[0]?.kind === 'video'

export function instagramFormat(type: PostType, media: readonly DraftMedia[]): InstagramFormat {
  switch (type) {
    case 'photo':
      return 'feed_photo'
    case 'carousel':
      return 'carousel'
    case 'reel':
      return 'reel'
    case 'story':
      return isStoryVideo(media) ? 'story_video' : 'story_photo'
  }
}

/** A carousel left with one photo (after «solo le foto») is a photo post. */
export function facebookFormat(type: PostType, media: readonly DraftMedia[]): FacebookFormat {
  switch (type) {
    case 'photo':
      return 'photo'
    case 'carousel':
      return media.length === 1 ? 'photo' : 'multi_photo'
    case 'reel':
      return 'reel'
    case 'story':
      return isStoryVideo(media) ? 'story_video' : 'story_photo'
  }
}

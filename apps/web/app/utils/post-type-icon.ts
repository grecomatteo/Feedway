import type { PostType } from './post-editor'

/**
 * The icon of each format, the same everywhere a post is shown: the type picker of «Nuovo post»,
 * the calendar, the lists, Oggi and the plan's cards.
 */
export const POST_TYPE_ICON: Record<PostType, string> = {
  photo: 'i-lucide-image',
  carousel: 'i-lucide-gallery-horizontal-end',
  reel: 'i-lucide-clapperboard',
  story: 'i-lucide-circle-dashed',
}

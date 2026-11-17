import type { MediaKind } from '../media/media.js'
import type { PostType } from './types.js'

/**
 * The type the editor proposes for the files chosen (§11.2 point 2, plan 05 Scelta 7): one
 * photo is a photo, one video a reel, more files a carousel. A story is never proposed: the
 * person chooses it. null: no file yet.
 */
export function suggestType(media: readonly { kind: MediaKind }[]): PostType | null {
  if (media.length === 0) return null
  if (media.length > 1) return 'carousel'
  return media[0]?.kind === 'video' ? 'reel' : 'photo'
}

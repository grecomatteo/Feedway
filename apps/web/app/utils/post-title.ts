import type { PostType } from '@app/domain'

type Translate = (key: string, named?: Record<string, unknown>) => string

/**
 * What a row calls a post (D-120.7): the start of its text on one line; without text, its type
 * and its first file, «Storia · IMG_0233»; without a file to name (the Viewer, D-72), «Storia
 * senza testo».
 */
export function postTitle(
  post: { text: string; type: PostType; firstFile: string | null },
  t: Translate,
): string {
  const text = post.text.trim().replace(/\s+/g, ' ')
  if (text) return text
  const type = t(`posts.type.${post.type}`)
  return post.firstFile ? `${type} · ${post.firstFile}` : t('posts.list.noTextOf', { type })
}

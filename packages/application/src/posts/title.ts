import type { PostType } from '@app/domain'
import type { Translate } from '../ports/translator.js'

/**
 * What a message calls a post without text (D-120.7), as the panel's rows: its type and its first
 * file, «Storia · IMG_0233»; without a file to name, «Storia senza testo».
 */
export function untitledPost(t: Translate, type: PostType, firstFile: string | null): string {
  const kind = t(`posts.type.${type}`)
  return firstFile === null ? t('posts.list.noTextOf', { type: kind }) : `${kind} · ${firstFile}`
}

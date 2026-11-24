/**
 * The name a post without text goes by, with its type: «Storia · IMG_0233» (D-120.7). The panel
 * and the notifications say the type in their own words; this is the file's part, the name it
 * was uploaded with, without its extension. Null: no name to say.
 */
export function fileTitle(originalName: string | null): string | null {
  const name = originalName?.trim() ?? ''
  if (!name) return null
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

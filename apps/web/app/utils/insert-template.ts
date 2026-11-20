/** A template of the client, as «Inserisci» puts it in the caption (§11.7). */
export interface InsertedTemplate {
  kind: 'signature' | 'hashtags' | 'caption'
  body: string
}

/**
 * The text with the template put between `start` and `end` (the cursor, or the selection it
 * replaces), and where the cursor goes: right after the template. A signature or hashtags go
 * on a paragraph of their own: a blank line before them when text comes before, and after
 * them when text comes after (D-80.3), without doubling the lines already there.
 */
export function insertTemplate(
  text: string,
  start: number,
  end: number,
  template: InsertedTemplate,
): { text: string; cursor: number } {
  const before = text.slice(0, start)
  let after = text.slice(end)
  const own = template.kind !== 'caption'
  const gap = (side: string, edge: 'end' | 'start') => {
    if (!own || side.trim() === '') return ''
    const lines = edge === 'end' ? /\n*$/.exec(side) : /^\n*/.exec(side)
    const have = lines?.[0].length ?? 0
    return '\n'.repeat(Math.max(0, 2 - have))
  }
  const lead = gap(before, 'end')
  // the new paragraph does not start with the space that came after the cursor
  if (own && after.trim() !== '') after = after.replace(/^[ \t]+/, '')
  const trail = gap(after, 'start')
  const inserted = lead + template.body
  return { text: before + inserted + trail + after, cursor: start + inserted.length }
}

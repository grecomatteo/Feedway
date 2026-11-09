import type { GraphObject } from './fixtures.ts'

/** `a,b{c,d}` → { a: null, b: { c: null, d: null } } */
export type FieldTree = Map<string, FieldTree | null>

export function parseFields(input: string): FieldTree {
  const root: FieldTree = new Map()
  const stack: FieldTree[] = [root]
  let name = ''
  const flush = () => {
    const trimmed = name.trim()
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- stack is never empty
    if (trimmed !== '') stack.at(-1)!.set(trimmed, null)
    name = ''
  }
  for (const char of input) {
    if (char === ',') flush()
    else if (char === '{') {
      const child: FieldTree = new Map()
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- stack is never empty
      stack.at(-1)!.set(name.trim(), child)
      stack.push(child)
      name = ''
    } else if (char === '}') {
      flush()
      if (stack.length > 1) stack.pop()
    } else name += char
  }
  flush()
  return root
}

const DEFAULT_FIELDS: FieldTree = new Map([
  ['id', null],
  ['name', null],
])

const isRef = (value: unknown): value is { ref: string } =>
  typeof value === 'object' && value !== null && 'ref' in value

/**
 * Picks the requested fields, like Meta: `id` always, absent fields left out, a reference to
 * another node rendered with its own sub-fields (only `id` when none are asked).
 */
export function renderObject(
  object: Record<string, unknown>,
  fields: FieldTree | null,
  lookup: (id: string) => GraphObject | undefined,
): Record<string, unknown> {
  const wanted = fields ?? DEFAULT_FIELDS
  const out: Record<string, unknown> = object.id === undefined ? {} : { id: object.id }
  for (const [name, sub] of wanted) {
    const value = object[name]
    if (value === undefined) continue
    if (isRef(value)) {
      const target = lookup(value.ref)
      if (target !== undefined)
        out[name] = renderObject(target, sub ?? new Map([['id', null]]), lookup)
    } else out[name] = value
  }
  return out
}

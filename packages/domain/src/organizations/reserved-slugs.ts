/** First path segments of the panel: an agency slug sits at `/<slug>` and must not shadow them. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'accedi',
  'agenzie',
  'attiva',
  'reimposta',
  'account',
  'profilo',
  'privacy',
  'sicurezza',
  'piattaforma',
  'api',
  'm',
  'share',
  '_nuxt',
  'assets',
  'health',
  'ready',
])

const MAX_SLUG_LENGTH = 60

export function slugFromName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'agenzia' : slug
}

/** The slug of the name, or the first `<slug>-N` (N ≥ 2) that is neither reserved nor taken. */
export async function availableSlug(
  name: string,
  isTaken: (slug: string) => boolean | Promise<boolean>,
): Promise<string> {
  const base = slugFromName(name)
  for (let n = 1; ; n++) {
    const suffix = `-${String(n)}`
    const candidate =
      n === 1
        ? base
        : `${base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!RESERVED_SLUGS.has(candidate) && !(await isTaken(candidate))) return candidate
  }
}

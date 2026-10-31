/** First path segments of the panel: an agency slug sits at `/<slug>` and must not shadow them. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'accedi',
  'agenzie',
  'attiva',
  'reimposta',
  'account',
  'conferma-email',
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

export function slugFromName(name: string, fallback = 'agenzia'): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '')
  return slug === '' ? fallback : slug
}

async function firstFree(
  base: string,
  reserved: ReadonlySet<string>,
  isTaken: (slug: string) => boolean | Promise<boolean>,
): Promise<string> {
  for (let n = 1; ; n++) {
    const suffix = `-${String(n)}`
    const candidate =
      n === 1
        ? base
        : `${base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!reserved.has(candidate) && !(await isTaken(candidate))) return candidate
  }
}

/** The slug of the name, or the first `<slug>-N` (N ≥ 2) that is neither reserved nor taken. */
export function availableSlug(
  name: string,
  isTaken: (slug: string) => boolean | Promise<boolean>,
): Promise<string> {
  return firstFree(slugFromName(name), RESERVED_SLUGS, isTaken)
}

const NO_RESERVED: ReadonlySet<string> = new Set()

/**
 * A workspace slug, unique inside its agency. Workspaces sit under `/<agency>/spazi/<slug>`
 * and in `?spazio=<slug>`, never at the root, so the panel's reserved words do not apply.
 */
export function availableWorkspaceSlug(
  name: string,
  isTaken: (slug: string) => boolean | Promise<boolean>,
): Promise<string> {
  return firstFree(slugFromName(name, 'spazio'), NO_RESERVED, isTaken)
}

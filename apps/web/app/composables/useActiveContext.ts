import type { WorkspaceView } from '~/composables/useOrganization'

export interface ProfileAccount {
  id: string
  platform: 'instagram' | 'facebook'
  externalId: string
  name: string
  username: string | null
  /** Feedway's copy of the picture, in the panel; null: none yet, the initials. */
  avatarUrl: string | null
  active: boolean
  health: 'ok' | 'warning' | 'error' | null
  healthMessage: string | null
  /** What the platform lets it publish in a day; null: not read yet. */
  quota?: { used: number; total: number; checkedAt: string } | null
  lastSyncedAt?: string | null
}
export interface WorkspaceProfile {
  key: string
  id: string
  accounts: ProfileAccount[]
}

/** The name of a profile (§3): its Facebook Page, or its only account. */
export const profileName = (p: WorkspaceProfile) =>
  (p.accounts.find((a) => a.platform === 'facebook') ?? p.accounts[0])?.name ?? ''

/** The photo of a profile: its Instagram's, else its Page's. */
export const profilePhoto = (p: WorkspaceProfile) =>
  (
    p.accounts.find((a) => a.platform === 'instagram' && a.avatarUrl) ??
    p.accounts.find((a) => a.avatarUrl)
  )?.avatarUrl ?? null

/** The profiles of a workspace, shared by the switcher and the pages that show them. */
export function useWorkspaceProfiles(workspaceId: Ref<string | null>) {
  const org = useOrganization()
  return useFetch<{ items: WorkspaceProfile[] }>(
    () => org.api(`/workspaces/${encodeURIComponent(workspaceId.value ?? '')}/profiles`),
    {
      key: () => `profiles-${org.slug.value}-${workspaceId.value ?? ''}`,
      server: false,
      lazy: true,
      immediate: false,
      watch: false,
    },
  )
}

/**
 * The active context of §14.6, kept in the address: "Tutti i clienti", a workspace
 * (`?spazio=<slug>`) or one of its profiles (`&profilo=<id>`). A slug or a profile that is
 * unknown, of a workspace the person does not see, outside the workspace or inactive all end up
 * the same way: "Tutti i clienti". The context is not a permission (§10): the server checks.
 */
export function useActiveContext() {
  const route = useRoute()
  const { data } = useWorkspaces()

  const visible = computed<WorkspaceView[]>(() =>
    (data.value?.items ?? []).filter((w) => w.archivedAt === null),
  )
  const askedWorkspace = computed(() => {
    const asked = clientSlugOf(route) ?? route.query['spazio']
    return typeof asked === 'string' ? (visible.value.find((w) => w.slug === asked) ?? null) : null
  })
  const askedProfile = computed(() => {
    const asked = route.query['profilo']
    return typeof asked === 'string' && asked !== '' ? asked : null
  })

  const workspaceId = computed(() => askedWorkspace.value?.id ?? null)
  const profiles = useWorkspaceProfiles(workspaceId)
  watch(
    workspaceId,
    (id) => {
      if (id) void profiles.refresh()
      else profiles.data.value = undefined
    },
    { immediate: true },
  )

  const profile = computed(() => {
    const id = askedProfile.value
    if (id === null) return null
    return profiles.data.value?.items.find((p) => p.accounts.some((a) => a.id === id)) ?? null
  })
  /** A profile was asked but is not one of the workspace's: nothing of it is shown. */
  const profileMissing = computed(
    () =>
      askedProfile.value !== null &&
      (askedWorkspace.value === null ||
        profiles.error.value != null ||
        (profiles.data.value !== undefined && profile.value === null)),
  )
  const workspace = computed(() => (profileMissing.value ? null : askedWorkspace.value))

  return { visible, workspace, profile, profiles, profileMissing }
}

type Route = ReturnType<typeof useRoute>

/**
 * The client of the client's page (`/<agenzia>/spazi/<slug>/…`, plan 04 Task 6a): there the
 * address names the client, and it is the context (D-5) whatever `?spazio=` says.
 */
export const clientSlugOf = (route: Pick<Route, 'params'>) => {
  const slug = route.params['slug']
  return typeof slug === 'string' && slug !== '' ? slug : null
}

const contextOf = (route: Pick<Route, 'params' | 'query'>) => {
  const context: Record<string, string> = {}
  for (const key of ['spazio', 'profilo'] as const) {
    const value = route.query[key]
    if (typeof value === 'string' && value !== '') context[key] = value
  }
  const client = clientSlugOf(route)
  if (client === null) return context
  // the client of the address, `spazio` first as the selector writes it
  const { profilo } = context
  return profilo === undefined ? { spazio: client } : { spazio: client, profilo }
}

/**
 * The context part of the address (`spazio`, `profilo`), for links that move to another page
 * of the agency without losing it (§14.6). Only what the switcher writes; nothing else follows.
 * Outside the agency's pages (the personal settings, `/account/*`) it is the one last seen in that agency.
 */
export function useContextQuery() {
  const route = useRoute()
  const org = useOrganization()
  const last = useLastContext()
  return computed(() => {
    if (route.params['org']) return contextOf(route)
    return last.value.slug === org.slug.value ? last.value.context : {}
  })
}

const useLastContext = () =>
  useState<{ slug: string; context: Record<string, string> }>('agency-context', () => ({
    slug: '',
    context: {},
  }))

/** Called by the agency's layout: the agency and context to keep for the personal pages. */
export function useRememberAgency() {
  const route = useRoute()
  const agency = useState<string>('agency-slug', () => '')
  const last = useLastContext()
  watch(
    () => [route.params['org'], route.params['slug'], route.query] as const,
    ([slug]) => {
      if (!slug) return
      agency.value = String(slug)
      last.value = { slug: String(slug), context: contextOf(route) }
    },
    { immediate: true },
  )
}

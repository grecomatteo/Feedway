import type { WorkspaceView } from '~/composables/useOrganization'

export interface ProfileAccount {
  id: string
  platform: 'instagram' | 'facebook'
  externalId: string
  name: string
  username: string | null
  active: boolean
  health: 'ok' | 'warning' | 'error' | null
  healthMessage: string | null
}
export interface WorkspaceProfile {
  key: string
  id: string
  accounts: ProfileAccount[]
}

/** The name of a profile (§3): its Facebook Page, or its only account. */
export const profileName = (p: WorkspaceProfile) =>
  (p.accounts.find((a) => a.platform === 'facebook') ?? p.accounts[0])?.name ?? ''

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
    const asked = route.query['spazio']
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

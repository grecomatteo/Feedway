import type { Me } from '@app/contracts'

type MyOrganization = Me['organizations'][number]

export interface WorkspaceView {
  id: string
  name: string
  slug: string
  archivedAt: string | null
  myRole: 'owner' | 'admin' | 'manager' | 'publisher' | 'editor' | 'viewer'
}

/**
 * The agency of the address (`/<agenzia>/…`) as the signed-in person sees it. What they may use
 * is only to choose what the page shows: the server checks every request again.
 */
export function useOrganization() {
  const route = useRoute()
  const session = useSession()

  const me = computed(() => (session.view.value.state === 'active' ? session.view.value.me : null))
  // Outside the agency's pages (the personal settings, `/account/*`), the agency of the sidebar is the last one
  // visited in this tab, else the person's last one, else their only one.
  const remembered = useState<string>('agency-slug', () => '')
  const slug = computed(() => {
    const asked = route.params['org']
    if (asked) return String(asked)
    const actives = (me.value?.organizations ?? []).filter((o) => o.status === 'active')
    const known = (s: string | null | undefined) =>
      s ? (actives.find((o) => o.slug === s)?.slug ?? null) : null
    return (
      known(remembered.value) ??
      known(me.value?.lastOrganizationSlug) ??
      (actives.length === 1 ? (actives[0]?.slug ?? '') : '')
    )
  })
  const organization = computed<MyOrganization | null>(
    () => me.value?.organizations.find((o) => o.slug === slug.value) ?? null,
  )
  const role = computed(() => organization.value?.role ?? null)
  const isManager = computed(() => role.value === 'owner' || role.value === 'admin')
  const may = computed(() => ({
    manageUsers: isManager.value,
    viewAudit: isManager.value,
    viewSettings: isManager.value,
    editSettings: role.value === 'owner',
    createWorkspace: isManager.value,
    manageAccounts: isManager.value,
    transferOwnership: role.value === 'owner',
  }))
  const active = computed(() => organization.value?.status === 'active')

  /** An `/api/v1/orgs/<agenzia>` path. */
  const api = (path = '') => `/api/v1/orgs/${encodeURIComponent(slug.value)}${path}`
  /** A page of this agency. */
  const to = (path = '') => `/${slug.value}${path}`

  return { me, slug, organization, role, may, active, api, to }
}

/** The workspaces this person sees in the agency, shared by the pages and the context switcher. */
export function useWorkspaces() {
  const org = useOrganization()
  return useFetch<{ items: WorkspaceView[] }>(() => org.api('/workspaces'), {
    key: () => `workspaces-${org.slug.value}`,
    server: false,
    lazy: true,
    immediate: org.active.value,
  })
}

/**
 * The agency's menu (D-81, `base.css` `.nav`): only what the person may use, and only what exists.
 * `link` carries the active context (§14.6) to the next page; `to` is the bare path, to mark the
 * current page. `group` says where an entry lives:
 * - `main`: the sidebar's first block (Oggi, Piano editoriale, Clienti, Libreria); Calendario is
 *   drawn by the shell after the first, off with «Presto» until stage 9, so the plan sits under it;
 * - `agency`: under the agency's name (Utenti, Impostazioni); on a phone in the «Tu» menu;
 * - `settings`: pages reached from Impostazioni (Registro attività, Privacy), until Task R8 moves
 *   them inside it.
 * `phoneMenu` entries are in the «Tu» menu too: the bar at the bottom has room for five places
 * only (spec §11.11).
 */
export interface AgencyNavItem {
  to: string
  label: string
  icon: string
  group: 'main' | 'agency' | 'settings'
  phoneMenu?: boolean
}

export function useAgencyNav() {
  const org = useOrganization()
  const context = useContextQuery()
  // the list the selector already asks for (useWorkspaces), read without asking it again
  const payload = useNuxtApp().payload.data
  // «Libreria» from Editor up (§10.2): Owner and Admin, or a role above Viewer in some client
  const usesAnyLibrary = computed(() => {
    if (org.may.value.manageUsers) return true
    const list = payload[`workspaces-${org.slug.value}`] as { items: WorkspaceView[] } | undefined
    return (list?.items ?? []).some((w) => w.archivedAt === null && usesLibrary(w))
  })
  // «Piano editoriale» (§11.12): with the module on and a client the person sees (`plan.view`)
  const seesAnyPlan = computed(() => {
    if (org.organization.value?.modules.plan !== true) return false
    if (org.may.value.manageUsers) return true
    const list = payload[`workspaces-${org.slug.value}`] as { items: WorkspaceView[] } | undefined
    return (list?.items ?? []).some((w) => w.archivedAt === null)
  })
  const items = computed(() => {
    const may = org.may.value
    const list: AgencyNavItem[] = [
      { to: org.to(), label: 'agency.nav.home', icon: 'i-lucide-sun', group: 'main' },
    ]
    if (seesAnyPlan.value)
      list.push({
        to: org.to('/piano'),
        label: 'agency.nav.plan',
        icon: 'i-lucide-notebook-pen',
        group: 'main',
        phoneMenu: true,
      })
    list.push({
      to: org.to('/spazi'),
      label: 'agency.nav.workspaces',
      icon: 'i-lucide-briefcase-business',
      group: 'main',
    })
    if (usesAnyLibrary.value)
      list.push({
        to: org.to('/libreria'),
        label: 'agency.nav.library',
        icon: 'i-lucide-images',
        group: 'main',
        phoneMenu: true,
      })
    if (may.manageUsers)
      list.push({
        to: org.to('/utenti'),
        label: 'agency.nav.users',
        icon: 'i-lucide-users',
        group: 'agency',
        phoneMenu: true,
      })
    // one «Impostazioni» for the person's and the agency's settings (Matteo, 13/11)
    list.push({ to: '/account', label: 'nav.settings', icon: 'i-lucide-settings', group: 'agency' })
    if (may.viewAudit)
      list.push({
        to: org.to('/impostazioni/registro'),
        label: 'agency.nav.audit',
        icon: 'i-lucide-scroll-text',
        group: 'settings',
      })
    list.push({
      to: '/account/privacy',
      label: 'agency.nav.privacy',
      icon: 'i-lucide-shield',
      group: 'settings',
    })
    return list
  })
  return computed(() =>
    items.value.map((item) => ({
      ...item,
      // the settings have no client context of their own
      link: item.to.startsWith('/account') ? item.to : { path: item.to, query: context.value },
    })),
  )
}

/**
 * Who creates posts and where «Nuovo post» goes: Owner and Admin everywhere, anyone else in a
 * client where they are more than a Viewer (§10.2). In a client's context it opens that client's
 * editor; in «Tutti i clienti» `post/nuovo` asks for the client first.
 */
export function useNewPost() {
  const org = useOrganization()
  const route = useRoute()
  const context = useContextQuery()
  const { data: workspaces } = useWorkspaces()
  const allowed = computed(
    () =>
      org.may.value.manageUsers ||
      (workspaces.value?.items ?? []).some((w) => !w.archivedAt && w.myRole !== 'viewer'),
  )
  const link = computed(() => {
    const asked = clientSlugOf(route) ?? context.value['spazio']
    const client = (workspaces.value?.items ?? []).find(
      (w) => w.slug === asked && !w.archivedAt && w.myRole !== 'viewer',
    )
    if (!client) return { path: org.to('/post/nuovo'), query: context.value }
    const profilo = context.value['profilo']
    return {
      path: org.to(`/spazi/${encodeURIComponent(client.slug)}/post/nuovo`),
      query: profilo ? { profilo } : {},
    }
  })
  return { allowed, link }
}

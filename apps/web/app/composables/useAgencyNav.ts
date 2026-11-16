/**
 * The agency's menu: only what the person may use, and only what exists in this stage. `link`
 * carries the active context (§14.6) to the next page; `to` is the bare path, to mark the
 * current page. `inUserMenu` entries are opened rarely: they live in the user's menu, not in the
 * sidebar (Matteo, 13/11: activity log, privacy). `inPhoneMenu` entries are in the sidebar on a
 * computer and in the «Tu» menu on a phone, where the bar at the bottom has no room for them
 * (spec §11.11). The client holds its profiles (proposal P): no «Account social» entry. «Media»
 * is only in the sidebar: on a phone the library opens from the client's page (plan 04 Task 12).
 */
export function useAgencyNav() {
  const org = useOrganization()
  const context = useContextQuery()
  // the list the selector already asks for (useWorkspaces), read without asking it again
  const payload = useNuxtApp().payload.data
  // «Media» from Editor up (§10.2): Owner and Admin, or a role above Viewer in some client
  const usesAnyLibrary = computed(() => {
    if (org.may.value.manageUsers) return true
    const list = payload[`workspaces-${org.slug.value}`] as { items: WorkspaceView[] } | undefined
    return (list?.items ?? []).some((w) => w.archivedAt === null && usesLibrary(w))
  })
  const items = computed(() => {
    const may = org.may.value
    const list: {
      to: string
      label: string
      icon: string
      inUserMenu?: boolean
      inPhoneMenu?: boolean
    }[] = [
      { to: org.to(), label: 'agency.nav.home', icon: 'i-lucide-house' },
      { to: org.to('/spazi'), label: 'agency.nav.workspaces', icon: 'i-lucide-briefcase' },
    ]
    // on a phone the library opens from the client's tab: the bar at the bottom has no room
    if (usesAnyLibrary.value)
      list.push({ to: org.to('/media'), label: 'agency.nav.media', icon: 'i-lucide-images' })
    if (may.manageUsers)
      list.push({
        to: org.to('/utenti'),
        label: 'agency.nav.users',
        icon: 'i-lucide-users',
        inPhoneMenu: true,
      })
    if (may.viewAudit)
      list.push({
        to: org.to('/registro'),
        label: 'agency.nav.audit',
        icon: 'i-lucide-scroll-text',
        inUserMenu: true,
      })
    list.push({
      to: org.to('/privacy'),
      label: 'agency.nav.privacy',
      icon: 'i-lucide-shield',
      inUserMenu: true,
    })
    return list
  })
  return computed(() =>
    items.value.map((item) => ({ ...item, link: { path: item.to, query: context.value } })),
  )
}

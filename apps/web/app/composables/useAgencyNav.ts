/**
 * The agency's menu: only what the person may use, and only what exists in this stage. `link`
 * carries the active context (§14.6) to the next page; `to` is the bare path, to mark the
 * current page. `inUserMenu` entries are opened rarely: they live in the user's menu, not in the
 * sidebar (Matteo, 13/11: activity log, settings, privacy).
 */
export function useAgencyNav() {
  const org = useOrganization()
  const context = useContextQuery()
  const items = computed(() => {
    const may = org.may.value
    const list: { to: string; label: string; icon: string; inUserMenu?: boolean }[] = [
      { to: org.to(), label: 'agency.nav.home', icon: 'i-lucide-house' },
      { to: org.to('/spazi'), label: 'agency.nav.workspaces', icon: 'i-lucide-briefcase' },
    ]
    if (may.manageAccounts)
      list.push({ to: org.to('/account'), label: 'agency.nav.accounts', icon: 'i-lucide-at-sign' })
    if (may.manageUsers)
      list.push({ to: org.to('/utenti'), label: 'agency.nav.users', icon: 'i-lucide-users' })
    if (may.viewAudit)
      list.push({
        to: org.to('/registro'),
        label: 'agency.nav.audit',
        icon: 'i-lucide-scroll-text',
        inUserMenu: true,
      })
    if (may.viewSettings)
      list.push({
        to: org.to('/impostazioni'),
        label: 'agency.nav.settings',
        icon: 'i-lucide-settings',
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

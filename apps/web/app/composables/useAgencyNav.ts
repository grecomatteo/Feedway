/** The agency's menu: only what the person may use, and only what exists in this stage. */
export function useAgencyNav() {
  const org = useOrganization()
  return computed(() => {
    const may = org.may.value
    const list: { to: string; label: string; icon: string }[] = [
      { to: org.to(), label: 'agency.nav.home', icon: 'i-lucide-house' },
      { to: org.to('/spazi'), label: 'agency.nav.workspaces', icon: 'i-lucide-briefcase' },
    ]
    if (may.manageUsers)
      list.push({ to: org.to('/utenti'), label: 'agency.nav.users', icon: 'i-lucide-users' })
    if (may.viewAudit)
      list.push({
        to: org.to('/registro'),
        label: 'agency.nav.audit',
        icon: 'i-lucide-scroll-text',
      })
    if (may.viewSettings)
      list.push({
        to: org.to('/impostazioni'),
        label: 'agency.nav.settings',
        icon: 'i-lucide-settings',
      })
    return list
  })
}

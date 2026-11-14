/**
 * The client of the client's page (`/<agenzia>/spazi/<slug>/…`), shared by the page and its tabs:
 * from the list of the workspaces the person sees, archived ones included, so an unknown client
 * and one they do not see look the same. Its profiles share the selector's request.
 */
export function useClientPage() {
  const route = useRoute()
  const { data, status, refresh } = useWorkspaces()
  const client = computed(
    () => data.value?.items.find((w) => w.slug === route.params['slug']) ?? null,
  )
  const missing = computed(() => status.value === 'success' && client.value === null)
  const clientId = computed(() => client.value?.id ?? null)
  const profiles = useWorkspaceProfiles(clientId)
  watch(
    clientId,
    (id) => {
      if (id) void profiles.refresh()
    },
    { immediate: true },
  )
  return { client, missing, profiles, refreshClients: refresh }
}

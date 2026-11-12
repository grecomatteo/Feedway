import type { MetaIntegration } from '@app/contracts'

type ConnectionStatus = 'pending' | 'active' | 'expired' | 'revoked'

/**
 * Where the first setup of the agency is (spec §8.1, plan 03 Task 12): read from the data, never
 * stored. 1: no Meta app. 2: no working system user (steps 2–4 cannot be checked one by one, so
 * the page walks them). 5: no account imported. 6: done. Owner only: for anyone else, `step` is
 * null and nothing is fetched.
 */
export function useFirstSetup() {
  const org = useOrganization()
  const owner = computed(() => org.may.value.editSettings && org.active.value)
  const opts = { server: false, lazy: true, immediate: owner.value }

  const app = useFetch<{ integration: MetaIntegration | null }>(
    () => org.api('/integrations/meta'),
    { ...opts, key: () => `meta-integration-${org.slug.value}` },
  )
  const connections = useFetch<{
    items: { id: string; kind: string; status: ConnectionStatus; createdAt: string }[]
  }>(() => org.api('/connections'), { ...opts, key: () => `connections-${org.slug.value}` })
  const accounts = useFetch<{ items: unknown[] }>(() => org.api('/accounts?limit=1'), {
    ...opts,
    key: () => `first-setup-accounts-${org.slug.value}`,
  })

  const integration = computed(() => app.data.value?.integration ?? null)
  const systemUser = computed(
    () =>
      connections.data.value?.items.find(
        (c) => c.kind === 'meta_system_user' && (c.status === 'active' || c.status === 'pending'),
      ) ?? null,
  )
  const error = computed(
    () => app.error.value ?? connections.error.value ?? accounts.error.value ?? null,
  )
  const step = computed<1 | 2 | 5 | 6 | null>(() => {
    if (!owner.value || !app.data.value || !connections.data.value || !accounts.data.value)
      return null
    if (integration.value === null) return 1
    if (systemUser.value === null) return 2
    if (accounts.data.value.items.length === 0) return 5
    return 6
  })

  async function refresh() {
    await Promise.all([app.refresh(), connections.refresh(), accounts.refresh()])
  }

  return { owner, step, integration, systemUser, error, refresh, app }
}

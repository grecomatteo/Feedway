<script setup lang="ts">
import type { MetaIntegration } from '@app/contracts'

/**
 * Impostazioni → Integrazioni (spec §8.3, plan 04 Task 6c): one entry per platform or service,
 * each with its state. Today only Meta; email and Telegram come with the notifications.
 */
definePageMeta({ layout: 'agency' })

type ConnectionStatus = 'pending' | 'active' | 'expired' | 'revoked'

const org = useOrganization()
const context = useContextQuery()
const { t } = useI18n()

useHead({ title: () => t('orgSettings.tabs.integrations') })
if (!org.may.value.viewSettings) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

const { data: app, error: appError } = useFetch<{ integration: MetaIntegration | null }>(
  () => org.api('/integrations/meta'),
  { key: () => `meta-integration-${org.slug.value}`, server: false, lazy: true },
)
const { data: connections } = useFetch<{ items: { id: string; status: ConnectionStatus }[] }>(
  () => org.api('/connections'),
  {
    key: () => `connections-${org.slug.value}`,
    server: false,
    lazy: true,
    immediate: org.may.value.manageAccounts,
  },
)

/** The state of Meta: the app first, then the connections that need a hand. */
const meta = computed<{ tone: 'success' | 'warning' | 'error' | 'neutral'; label: string } | null>(
  () => {
    if (appError.value) return null
    if (!app.value) return null
    const i = app.value.integration
    if (!i) return { tone: 'neutral', label: t('metaIntegration.notConfigured') }
    if (i.rejectedAt) return { tone: 'error', label: t('metaIntegration.rejected') }
    const broken = (connections.value?.items ?? []).filter(
      (c) => c.status === 'expired' || c.status === 'revoked',
    ).length
    if (broken > 0)
      return { tone: 'warning', label: t('integrations.reconnect', { n: broken }, broken) }
    if (!i.verifiedAt) return { tone: 'neutral', label: t('metaIntegration.notVerified') }
    return { tone: 'success', label: t('metaIntegration.verified') }
  },
)
const metaDetail = computed(() => {
  const n = connections.value?.items.length
  return n === undefined ? null : t('integrations.connections', { n }, n)
})
</script>

<template>
  <SettingsShell>
    <!-- one group of rows like «Sicurezza» (screens 23–26): the platform, what it holds, its
         state as a dot and a word, the row leads to its page -->
    <SettingsGroup :title="$t('orgSettings.tabs.integrations')">
      <ul :aria-label="$t('orgSettings.tabs.integrations')">
        <li>
          <NuxtLink
            :to="{ path: org.to('/impostazioni/integrazioni/meta'), query: context }"
            class="group grid min-h-15 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 rounded-card px-4 py-3 hover:bg-(--app-nav-hover) max-md:grid-cols-[minmax(0,1fr)_auto]"
          >
            <span class="min-w-0">
              <span class="block font-medium">{{ $t('metaIntegration.title') }}</span>
              <span class="block text-detail text-(--app-text-muted)">
                {{ $t('integrations.meta.explain') }}
                <template v-if="metaDetail"> · {{ metaDetail }}</template>
              </span>
            </span>
            <StatusDot
              v-if="meta"
              :tone="meta.tone === 'error' ? 'danger' : meta.tone"
              :label="meta.label"
              class="shrink-0 max-md:col-span-2 max-md:row-start-2"
              data-testid="meta-entry-state"
            />
            <UIcon
              name="i-lucide-chevron-right"
              class="size-4 shrink-0 text-(--app-text-muted) max-md:col-start-2 max-md:row-start-1"
              aria-hidden="true"
            />
          </NuxtLink>
        </li>
      </ul>
    </SettingsGroup>
  </SettingsShell>
</template>

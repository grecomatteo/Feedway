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
    <ul class="space-y-3" :aria-label="$t('orgSettings.tabs.integrations')">
      <li>
        <NuxtLink
          :to="{ path: org.to('/impostazioni/integrazioni/meta'), query: context }"
          class="flex min-h-16 items-center gap-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 hover:border-(--app-border-strong) sm:p-5"
        >
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-(--app-surface-sunken)"
            aria-hidden="true"
          >
            <UIcon name="i-lucide-infinity" class="size-5" />
          </span>
          <span class="min-w-0 flex-1 space-y-2 sm:flex sm:items-center sm:gap-4 sm:space-y-0">
            <span class="block min-w-0 space-y-0.5 sm:flex-1">
              <span class="block font-semibold">{{ $t('metaIntegration.title') }}</span>
              <span class="block text-sm text-(--app-text-muted)">
                {{ $t('integrations.meta.explain') }}
                <template v-if="metaDetail"> · {{ metaDetail }}</template>
              </span>
            </span>
            <UBadge
              v-if="meta"
              :color="meta.tone"
              variant="subtle"
              class="shrink-0"
              data-testid="meta-entry-state"
            >
              {{ meta.label }}
            </UBadge>
          </span>
          <UIcon
            name="i-lucide-chevron-right"
            class="size-5 shrink-0 text-(--app-text-muted)"
            aria-hidden="true"
          />
        </NuxtLink>
      </li>
    </ul>
  </SettingsShell>
</template>

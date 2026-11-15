<script setup lang="ts">
import type { MetaIntegration, MetaReminder } from '@app/contracts'

/**
 * Impostazioni → Integrazioni → Meta (spec §8.3, plan 04 Task 6c): the agency's Meta app (only the
 * Owner changes it, the Admin reads it), then what Owner and Admin manage (§10.2): the reminders,
 * the connections, the profiles and «Aggiungi account». `?account=` comes from «Ricollega».
 */
definePageMeta({ layout: 'agency' })

const org = useOrganization()
const route = useRoute()
const context = useContextQuery()
const { t } = useI18n()
const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()

useHead({ title: () => t('metaIntegration.title') })
if (!org.may.value.viewSettings) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

const editable = computed(() => org.may.value.editSettings)
const focusAccount = computed(() => {
  const a = route.query['account']
  return typeof a === 'string' ? a : null
})

const { data, status, error, refresh } = useFetch<{ integration: MetaIntegration | null }>(
  () => org.api('/integrations/meta'),
  { key: () => `meta-integration-${org.slug.value}`, server: false, lazy: true },
)
const integration = computed(() => data.value?.integration ?? null)

// the reminders are a notice on top, for who manages the connections (§8.4)
const { data: reminders } = useFetch<{ items: MetaReminder[] }>(
  () => org.api('/accounts/reminders'),
  {
    key: () => `meta-reminders-${org.slug.value}`,
    server: false,
    lazy: true,
    immediate: org.may.value.manageAccounts,
  },
)

const passkeys = computed(() => org.me.value?.secondFactor.passkeys ?? 0)
const guideSteps = ['create', 'copy', 'checkup'] as const
</script>

<template>
  <SettingsShell>
    <div class="space-y-6">
      <div class="space-y-3">
        <NuxtLink
          :to="{ path: org.to('/impostazioni/integrazioni'), query: context }"
          class="inline-flex min-h-11 items-center gap-1 text-sm underline"
        >
          <UIcon name="i-lucide-arrow-left" aria-hidden="true" />
          {{ $t('integrations.back') }}
        </NuxtLink>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-1">
            <h2 class="text-2xl">{{ $t('metaIntegration.title') }}</h2>
            <p class="text-(--app-text-muted)">{{ $t('integrations.meta.explain') }}</p>
          </div>
          <UButton
            v-if="org.may.value.manageAccounts"
            :to="{ path: org.to('/impostazioni/integrazioni/meta/aggiungi'), query: context }"
            class="min-h-11"
            icon="i-lucide-plus"
          >
            {{ $t('socialAccounts.add') }}
          </UButton>
        </div>
      </div>

      <MetaReminders :items="reminders?.items ?? []" />

      <section
        aria-labelledby="meta-integration"
        class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 id="meta-integration" class="text-lg">{{ $t('metaIntegration.app') }}</h3>
          <UBadge
            v-if="data"
            :color="
              integration?.rejectedAt ? 'error' : integration?.verifiedAt ? 'success' : 'neutral'
            "
            variant="subtle"
            data-testid="meta-integration-state"
          >
            {{
              integration
                ? integration.rejectedAt
                  ? $t('metaIntegration.rejected')
                  : integration.verifiedAt
                    ? $t('metaIntegration.verified')
                    : $t('metaIntegration.notVerified')
                : $t('metaIntegration.notConfigured')
            }}
          </UBadge>
        </div>
        <p class="text-sm text-(--app-text-muted)">{{ $t('metaIntegration.explain') }}</p>
        <p v-if="!editable" class="text-sm text-(--app-text-muted)">
          {{ $t('orgSettings.ownerOnly') }}
        </p>

        <p v-if="!data && !error && (status === 'pending' || status === 'idle')" role="status">
          {{ $t('account.loading') }}
        </p>
        <div v-else-if="error" role="alert" class="space-y-3">
          <p class="flex items-center gap-2 text-(--app-danger)">
            <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
            {{ $t('account.loadError') }}
          </p>
          <UButton class="min-h-11" color="neutral" variant="outline" @click="() => refresh()">
            {{ $t('account.retry') }}
          </UButton>
        </div>
        <template v-else>
          <p v-if="integration" class="text-sm text-(--app-text-muted)">
            {{ $t('metaIntegration.updatedAt', { when: formatDate(integration.updatedAt, true) }) }}
            <template v-if="integration.rejectedAt">
              {{
                $t('metaIntegration.rejectedAt', { when: formatDate(integration.rejectedAt, true) })
              }}
            </template>
            <template v-else-if="integration.verifiedAt">
              {{
                $t('metaIntegration.verifiedAt', { when: formatDate(integration.verifiedAt, true) })
              }}
            </template>
          </p>
          <EmptyState
            v-else-if="!editable"
            icon="i-lucide-plug"
            :title="$t('metaIntegration.emptyTitle')"
            :text="$t('metaIntegration.emptyAdmin')"
          />

          <MetaAppForm
            v-if="integration || editable"
            :integration="integration"
            :editable="editable"
            :with-reauth="withReauth"
            @update:integration="data = { integration: $event }"
          />
        </template>
      </section>

      <MetaConnections
        v-if="org.may.value.manageAccounts"
        :with-reauth="withReauth"
        :focus-account="focusAccount"
      />

      <section
        aria-labelledby="meta-guide"
        class="space-y-3 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <h3 id="meta-guide" class="text-lg">{{ $t('metaIntegration.guide.title') }}</h3>
        <ol class="list-decimal space-y-2 pl-5">
          <li v-for="step in guideSteps" :key="step">
            {{ $t(`metaIntegration.guide.${step}`) }}
          </li>
        </ol>
        <p class="rounded-md border border-(--app-border-strong) bg-(--app-surface-sunken) p-3">
          {{ $t('metaIntegration.guide.pagePermissions') }}
        </p>
      </section>

      <ReauthDialog v-model:open="reauthOpen" :passkeys="passkeys" @done="reauthDone" />
    </div>
  </SettingsShell>
</template>

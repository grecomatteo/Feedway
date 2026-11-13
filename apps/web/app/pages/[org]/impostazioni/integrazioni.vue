<script setup lang="ts">
import type { MetaIntegration } from '@app/contracts'

definePageMeta({ layout: 'agency' })

const org = useOrganization()
const { t } = useI18n()
const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()

useHead({ title: () => t('metaIntegration.title') })
if (!org.may.value.viewSettings) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

const editable = computed(() => org.may.value.editSettings)

const { data, status, error, refresh } = useFetch<{ integration: MetaIntegration | null }>(
  () => org.api('/integrations/meta'),
  { key: () => `meta-integration-${org.slug.value}`, server: false, lazy: true },
)
const integration = computed(() => data.value?.integration ?? null)

const passkeys = computed(() => org.me.value?.secondFactor.passkeys ?? 0)
const guideSteps = ['create', 'copy', 'checkup'] as const
</script>

<template>
  <SettingsShell>
    <template #intro>
      <p v-if="!editable" class="text-(--app-text-muted)">{{ $t('orgSettings.ownerOnly') }}</p>
    </template>

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
      <section
        aria-labelledby="meta-integration"
        class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 id="meta-integration" class="text-lg">{{ $t('metaIntegration.title') }}</h2>
          <UBadge
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
      </section>

      <section
        aria-labelledby="meta-guide"
        class="space-y-3 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <h2 id="meta-guide" class="text-lg">{{ $t('metaIntegration.guide.title') }}</h2>
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
    </template>
  </SettingsShell>
</template>

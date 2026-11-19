<script setup lang="ts">
import type { PrivacyNotice } from '@app/contracts'

definePageMeta({ layout: 'agency' })

const org = useOrganization()
const { t } = useI18n()
useHead({ title: () => t('privacyNotice.title') })

const { data, status, error, refresh } = useFetch<PrivacyNotice>(() => org.api('/privacy'), {
  key: () => `privacy-${org.slug.value}`,
  server: false,
  lazy: true,
})
</script>

<template>
  <PageShell :title="$t('privacyNotice.title')">
    <p v-if="status === 'pending' || status === 'idle'" role="status">
      {{ $t('account.loading') }}
    </p>
    <div v-else-if="error" role="alert" class="space-y-3">
      <p class="text-(--app-danger)">{{ $t('account.loadError') }}</p>
      <UButton class="min-h-control" color="neutral" variant="outline" @click="() => refresh()">
        {{ $t('account.retry') }}
      </UButton>
    </div>
    <PrivacyNoticeView v-else-if="data" :notice="data" class="max-w-prose" />
  </PageShell>
</template>

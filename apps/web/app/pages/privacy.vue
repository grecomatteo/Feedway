<script setup lang="ts">
import type { PrivacyNotice } from '@app/contracts'

definePageMeta({ layout: 'auth' })

const { t } = useI18n()
useHead({ title: () => t('privacyNotice.title') })

const { data, status, error, refresh } = useFetch<PrivacyNotice>('/api/v1/privacy', {
  key: 'privacy-notice',
  server: false,
  lazy: true,
})
</script>

<template>
  <div class="space-y-5">
    <h1 class="text-2xl">{{ $t('privacyNotice.title') }}</h1>
    <p v-if="status === 'pending' || status === 'idle'" role="status">
      {{ $t('account.loading') }}
    </p>
    <div v-else-if="error" role="alert" class="space-y-3">
      <p class="text-(--app-danger)">{{ $t('account.loadError') }}</p>
      <UButton class="min-h-11" color="neutral" variant="outline" @click="() => refresh()">
        {{ $t('account.retry') }}
      </UButton>
    </div>
    <PrivacyNoticeView v-else-if="data" :notice="data" />
    <UButton to="/accedi" class="min-h-11" color="neutral" variant="outline">
      {{ $t('privacyNotice.backToSignIn') }}
    </UButton>
  </div>
</template>

<script setup lang="ts">
import type { Me } from '@app/contracts'

definePageMeta({ layout: 'personal' })

const { t } = useI18n()

useHead({ title: () => t('dataExport.title') })

const { data: me, error } = useFetch<Me>('/api/v1/me', { key: 'me', server: false, lazy: true })
const signedOut = computed(() => error.value?.statusCode === 401)
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-3xl">{{ $t('account.title') }}</h1>
      <p v-if="me" class="text-(--app-text-muted)">
        <span :title="me.name">{{ me.displayName }}</span
        >, {{ me.email }}
      </p>
    </header>

    <AccountTabs />

    <p v-if="signedOut" role="alert" class="flex items-center gap-2 text-(--app-danger)">
      <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
      {{ $t('account.signedOut') }}
    </p>
    <template v-else>
      <DataExportPanel :me="me ?? null" />
      <AccountDeletionPanel :me="me ?? null" />
    </template>
  </div>
</template>

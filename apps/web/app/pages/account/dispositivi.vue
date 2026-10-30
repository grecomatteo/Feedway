<script setup lang="ts">
import type { Me } from '@app/contracts'

interface MySession {
  id: string
  device: { browser: string; os: string }
  ipApprox: string | null
  createdAt: string
  lastActiveAt: string
  current: boolean
}

const { t } = useI18n()

useHead({ title: () => t('devices.title') })

const { data: me } = useFetch<Me>('/api/v1/me', { key: 'me', server: false, lazy: true })
const { data, error, refresh } = useFetch<{ items: MySession[] }>('/api/v1/me/sessions', {
  key: 'my-sessions',
  server: false,
  lazy: true,
})
const signedOut = computed(() => error.value?.statusCode === 401)
// after "Esci da tutti" this device has no session either: the page says so, nothing else to load
const allSignedOut = ref(false)
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-3xl">{{ $t('account.title') }}</h1>
      <p v-if="me && !allSignedOut" class="text-(--app-text-muted)">
        <span :title="me.name">{{ me.displayName }}</span
        >, {{ me.email }}
      </p>
    </header>

    <AccountTabs />

    <p v-if="allSignedOut" role="status" class="flex items-center gap-2 text-(--app-success)">
      <UIcon name="i-lucide-circle-check" aria-hidden="true" />
      {{ $t('devices.allSignedOut') }}
    </p>
    <p v-else-if="!data && !error" role="status">
      {{ $t('account.loading') }}
    </p>
    <div v-else-if="error" role="alert" class="space-y-3">
      <p class="flex items-center gap-2 text-(--app-danger)">
        <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
        {{ signedOut ? $t('account.signedOut') : $t('account.loadError') }}
      </p>
      <UButton
        v-if="!signedOut"
        class="min-h-11"
        color="neutral"
        variant="outline"
        @click="() => refresh()"
      >
        {{ $t('account.retry') }}
      </UButton>
    </div>
    <DeviceList
      v-else-if="data"
      :sessions="data.items"
      @changed="() => refresh()"
      @all-signed-out="allSignedOut = true"
    />
  </div>
</template>

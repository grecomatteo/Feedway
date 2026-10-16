<script setup lang="ts">
import { PRODUCT_NAME } from '@app/config/product'

useHead({ title: PRODUCT_NAME })

const { data, status, error, refresh } = useFetch('/api/ready', {
  key: 'system-ready',
  server: false,
  lazy: true,
})
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-3xl">{{ PRODUCT_NAME }}</h1>
    <section
      aria-labelledby="system-status"
      class="rounded-xl border border-(--app-border) bg-(--app-surface) p-4"
    >
      <h2 id="system-status" class="mb-2 text-lg">{{ $t('home.title') }}</h2>
      <p v-if="status === 'pending' || status === 'idle'" role="status">
        {{ $t('home.loading') }}
      </p>
      <p v-else-if="error" role="alert" class="flex items-center gap-2 text-(--app-danger)">
        <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
        {{ $t('home.error') }}
      </p>
      <p v-else-if="data" role="status" class="flex items-center gap-2 text-(--app-success)">
        <UIcon name="i-lucide-circle-check" aria-hidden="true" />
        {{ $t('home.ok') }}
      </p>
      <UButton
        v-if="error"
        class="mt-3 min-h-11"
        color="neutral"
        variant="outline"
        @click="() => refresh()"
      >
        {{ $t('home.retry') }}
      </UButton>
    </section>
  </div>
</template>

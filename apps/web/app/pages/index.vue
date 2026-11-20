<script setup lang="ts">
import { PRODUCT_NAME } from '@app/config/product'

/**
 * The address of the panel without a path (D-99): signed in, the person is sent on to their
 * agency; otherwise the way in and whether the system answers, in the pages-before-the-panel
 * look (screen 01): the logo, one column, no bar at the top.
 */
definePageMeta({ layout: 'auth' })
useHead({ title: PRODUCT_NAME })

const { data, status, error, refresh } = useFetch('/api/ready', {
  key: 'system-ready',
  server: false,
  lazy: true,
})
</script>

<template>
  <div class="grid gap-5">
    <h1 class="sr-only">{{ PRODUCT_NAME }}</h1>
    <!-- signed in, /accedi goes straight to the person's agency -->
    <UButton to="/accedi" block size="xl" class="min-h-control" icon="i-lucide-log-in">
      {{ $t('home.signIn') }}
    </UButton>
    <section
      aria-labelledby="system-status"
      class="flex min-h-row items-center gap-3 rounded-card border border-(--app-border) bg-(--app-surface) px-4 py-2.5"
    >
      <h2 id="system-status" class="sr-only">{{ $t('home.title') }}</h2>
      <p
        v-if="status === 'pending' || status === 'idle'"
        role="status"
        class="flex flex-1 items-center gap-2 text-(--app-text-muted)"
      >
        <UIcon name="i-lucide-loader" class="size-4 shrink-0" aria-hidden="true" />
        {{ $t('home.loading') }}
      </p>
      <p v-else-if="error" role="alert" class="flex flex-1 items-center gap-2">
        <UIcon
          name="i-lucide-triangle-alert"
          class="size-4 shrink-0 text-(--app-danger)"
          aria-hidden="true"
        />
        {{ $t('home.error') }}
      </p>
      <p v-else-if="data" role="status" class="flex flex-1 items-center gap-2">
        <StatusDot tone="success" :label="$t('home.ok')" />
      </p>
      <UButton v-if="error" size="sm" color="neutral" variant="outline" @click="() => refresh()">
        {{ $t('home.retry') }}
      </UButton>
    </section>
  </div>
</template>

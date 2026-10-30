<script setup lang="ts">
const route = useRoute()

const tabs = [
  { to: '/account', label: 'account.tabs.profile' },
  { to: '/account/sicurezza', label: 'account.tabs.security' },
  { to: '/account/dispositivi', label: 'account.tabs.devices' },
] as const
</script>

<template>
  <nav :aria-label="$t('account.tabs.label')">
    <ul class="inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-(--app-surface-sunken) p-1">
      <li v-for="tab in tabs" :key="tab.to">
        <NuxtLink
          :to="tab.to"
          :aria-current="route.path === tab.to ? 'page' : undefined"
          class="flex min-h-11 items-center rounded-md px-4 text-sm text-(--app-text-muted) aria-[current=page]:bg-(--app-surface) aria-[current=page]:font-semibold aria-[current=page]:text-(--app-text)"
        >
          {{ $t(tab.label) }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>

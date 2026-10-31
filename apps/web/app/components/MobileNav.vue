<script setup lang="ts">
/**
 * Below 768 px: five places with the + in the middle (spec §11.11). The + stays empty until
 * "Nuovo post" exists (stage 6); places for pages that do not exist yet stay empty too.
 */
const org = useOrganization()
const route = useRoute()
const may = computed(() => org.may.value)
const slots = computed(() => [
  { to: org.to(), label: 'agency.nav.home', icon: 'i-lucide-house' },
  { to: org.to('/spazi'), label: 'agency.nav.workspaces', icon: 'i-lucide-briefcase' },
  null,
  may.value.manageUsers
    ? { to: org.to('/utenti'), label: 'agency.nav.users', icon: 'i-lucide-users' }
    : null,
  { to: '/account', label: 'nav.account', icon: 'i-lucide-circle-user' },
])
const current = (to: string) =>
  to === org.to() ? route.path === to : route.path === to || route.path.startsWith(`${to}/`)
</script>

<template>
  <nav
    :aria-label="$t('agency.nav.label')"
    class="fixed inset-x-0 bottom-0 z-40 border-t border-(--app-border) bg-(--app-surface) pb-[env(safe-area-inset-bottom)] md:hidden"
  >
    <ul class="grid grid-cols-5">
      <li v-for="(slot, i) in slots" :key="i" class="flex">
        <NuxtLink
          v-if="slot"
          :to="slot.to"
          :aria-current="current(slot.to) ? 'page' : undefined"
          class="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-(--app-text-muted) aria-[current=page]:font-semibold aria-[current=page]:text-(--app-text)"
        >
          <UIcon :name="slot.icon" class="size-5" aria-hidden="true" />
          {{ $t(slot.label) }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>

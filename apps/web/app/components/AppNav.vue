<script setup lang="ts">
/** The header's links for the signed-in person; the agency's own menu arrives with its pages. */
const session = useSession()
const route = useRoute()

const me = computed(() => (session.view.value.state === 'active' ? session.view.value.me : null))
const links = computed(() => {
  const value = me.value
  if (!value) return []
  const list: { to: string; label: string }[] = []
  const home = session.home(value)
  if (home !== '/account') list.push({ to: home, label: 'nav.agency' })
  list.push({ to: '/account', label: 'nav.account' })
  if (value.platformRole === 'admin')
    list.push({ to: '/piattaforma/email', label: 'nav.systemEmail' })
  return list
})
const current = (to: string) => route.path === to || route.path.startsWith(`${to}/`)
</script>

<template>
  <nav v-if="me" :aria-label="$t('nav.label')" class="flex flex-wrap items-center gap-1">
    <NuxtLink
      v-for="link in links"
      :key="link.to"
      :to="link.to"
      :aria-current="current(link.to) ? 'page' : undefined"
      class="flex min-h-11 items-center rounded-md px-3 text-sm text-(--app-text-muted) hover:bg-(--app-surface-sunken) aria-[current=page]:font-semibold aria-[current=page]:text-(--app-text)"
    >
      {{ $t(link.label) }}
    </NuxtLink>
    <UButton
      class="min-h-11"
      color="neutral"
      variant="ghost"
      icon="i-lucide-log-out"
      @click="() => session.signOut()"
    >
      {{ $t('nav.signOut') }}
    </UButton>
  </nav>
</template>

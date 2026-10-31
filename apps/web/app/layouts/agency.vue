<script setup lang="ts">
const org = useOrganization()
const nav = useAgencyNav()
const session = useSession()
const route = useRoute()
const current = (to: string) =>
  to === org.to() ? route.path === to : route.path === to || route.path.startsWith(`${to}/`)
const me = computed(() => org.me.value)
// buttons drawn by the server do nothing until the page runs in the browser
const ready = useHydrated()
const many = computed(() => (me.value?.organizations.length ?? 0) > 1)
</script>

<template>
  <div class="min-h-dvh md:flex">
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-(--app-surface) focus:px-3 focus:py-2"
    >
      {{ $t('a11y.skipToContent') }}
    </a>

    <!-- computer: the sidebar -->
    <aside
      class="hidden w-64 shrink-0 flex-col gap-4 border-r border-(--app-border) bg-(--app-nav-bg) p-3 md:flex"
    >
      <NuxtLink :to="org.to()" class="flex min-h-11 items-center px-2"><AppLogo /></NuxtLink>
      <div class="space-y-1">
        <OrgSwitcher />
        <ContextSwitcher v-if="org.active.value" />
      </div>
      <nav :aria-label="$t('agency.nav.label')">
        <ul class="space-y-1">
          <li v-for="item in nav" :key="item.to">
            <NuxtLink
              :to="item.to"
              :aria-current="current(item.to) ? 'page' : undefined"
              class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm hover:bg-(--app-surface-sunken) aria-[current=page]:bg-(--app-brand-soft) aria-[current=page]:font-semibold"
            >
              <UIcon :name="item.icon" class="size-4" aria-hidden="true" />
              {{ $t(item.label) }}
            </NuxtLink>
          </li>
        </ul>
      </nav>
      <div class="mt-auto space-y-1 border-t border-(--app-border) pt-3">
        <NuxtLink
          v-if="me"
          to="/account"
          class="flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-(--app-surface-sunken)"
        >
          <UserAvatar :name="me.displayName" />
          <span class="truncate text-sm">{{ me.displayName }}</span>
        </NuxtLink>
        <div class="flex items-center justify-between">
          <UButton
            class="min-h-11"
            color="neutral"
            variant="ghost"
            icon="i-lucide-log-out"
            @click="() => session.signOut()"
          >
            {{ $t('nav.signOut') }}
          </UButton>
          <ThemeSwitcher />
        </div>
      </div>
    </aside>

    <!-- telefono: barra in alto e menu in basso -->
    <header
      class="flex items-center gap-2 border-b border-(--app-border) bg-(--app-surface) px-4 py-2 md:hidden"
    >
      <div class="min-w-0 flex-1 space-y-1">
        <OrgSwitcher v-if="many || !org.active.value" />
        <ContextSwitcher v-if="org.active.value" />
      </div>
      <ThemeSwitcher />
    </header>

    <main id="main" class="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-24 sm:px-6 md:pb-10">
      <fieldset v-if="org.active.value" :disabled="!ready" class="m-0 min-w-0 border-0 p-0">
        <slot />
      </fieldset>
      <section v-else aria-labelledby="suspended" class="space-y-3">
        <h1 id="suspended" class="text-3xl">{{ org.organization.value?.name }}</h1>
        <p role="alert">{{ $t('agencyHome.suspended') }}</p>
        <p v-if="many" class="text-(--app-text-muted)">{{ $t('agency.suspendedOthers') }}</p>
      </section>
    </main>
    <MobileNav />
  </div>
</template>

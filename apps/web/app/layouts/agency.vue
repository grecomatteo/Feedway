<script setup lang="ts">
const org = useOrganization()
const allNav = useAgencyNav()
const nav = computed(() => allNav.value.filter((item) => !item.inUserMenu))
const context = useContextQuery()
useRememberAgency()
const session = useSession()
const route = useRoute()
const current = (to: string) =>
  to === org.to() ? route.path === to : route.path === to || route.path.startsWith(`${to}/`)
const me = computed(() => org.me.value)
// the personal settings (`/account/*`) show the agency's menu too, but have no client context of its own
const inAgency = computed(() => Boolean(route.params['org']))
// buttons drawn by the server do nothing until the page runs in the browser
const ready = useHydrated()
const many = computed(() => (me.value?.organizations.length ?? 0) > 1)

// A suspension made by the platform must show without a reload: ask again who the person is
// when the tab comes back to the front and when they move to another agency.
const refresh = () => {
  if (document.visibilityState === 'visible') void session.load().catch(() => undefined)
}
onMounted(() => document.addEventListener('visibilitychange', refresh))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', refresh))
watch(org.slug, refresh)
</script>

<template>
  <div class="min-h-dvh bg-(--app-paper) md:flex">
    <!-- the paper of the union style under every page of the agency (Matteo, 14/11) -->
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-(--app-surface) focus:px-3 focus:py-2"
    >
      {{ $t('a11y.skipToContent') }}
    </a>

    <!-- computer: the sidebar -->
    <aside
      class="hidden w-64 shrink-0 flex-col gap-4 border-r border-(--app-border) bg-(--app-nav-bg) p-3 md:sticky md:top-0 md:flex md:h-dvh md:self-start md:overflow-y-auto"
    >
      <NuxtLink :to="{ path: org.to(), query: context }" class="flex min-h-11 items-center px-2"
        ><AppLogo
      /></NuxtLink>
      <div class="space-y-1">
        <OrgSwitcher />
        <ContextSwitcher v-if="org.active.value && inAgency" />
      </div>
      <nav v-if="org.active.value" :aria-label="$t('agency.nav.label')">
        <ul class="space-y-1">
          <li v-for="item in nav" :key="item.to">
            <NuxtLink
              :to="item.link"
              :aria-current="current(item.to) ? 'page' : undefined"
              class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm hover:bg-(--app-surface-sunken) aria-[current=page]:bg-(--app-brand-soft) aria-[current=page]:font-semibold"
            >
              <UIcon :name="item.icon" class="size-4" aria-hidden="true" />
              {{ $t(item.label) }}
            </NuxtLink>
          </li>
        </ul>
      </nav>
      <div class="mt-auto border-t border-(--app-border) pt-3">
        <UserMenu />
      </div>
    </aside>

    <!-- telefono: barra in alto e menu in basso -->
    <header
      class="flex items-center gap-2 border-b border-(--app-border) bg-(--app-surface) px-4 py-2 md:hidden"
    >
      <div class="min-w-0 flex-1 space-y-1">
        <OrgSwitcher v-if="many || !org.active.value" />
        <ContextSwitcher v-if="org.active.value && inAgency" />
      </div>
      <UserMenu variant="avatar" />
    </header>

    <main id="main" class="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-24 sm:px-6 md:pb-10">
      <!-- The page stays mounted while the agency is suspended, only hidden: Nuxt moves the route
           the layout reads only once a page has loaded, so without it the first link out of a
           suspended agency would change the address and nothing else. -->
      <fieldset
        v-show="org.active.value"
        :disabled="!ready || !org.active.value"
        class="m-0 min-w-0 border-0 p-0"
      >
        <slot />
      </fieldset>
      <section v-if="!org.active.value" aria-labelledby="suspended" class="space-y-3">
        <h1 id="suspended" class="text-3xl">{{ org.organization.value?.name }}</h1>
        <p role="alert">{{ $t('agencyHome.suspended') }}</p>
        <p v-if="many" class="text-(--app-text-muted)">{{ $t('agency.suspendedOthers') }}</p>
      </section>
    </main>
    <MobileNav v-if="org.active.value" />
  </div>
</template>

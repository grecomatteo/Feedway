<script setup lang="ts">
/**
 * The shell of every page of the agency (D-81): the sidebar on a computer; on a phone one row at
 * the top (the client selector and the bell) and the bar at the bottom. The agency itself changes
 * from the person's menu («Cambia agenzia»).
 */
const org = useOrganization()
useRememberAgency()
const session = useSession()
const route = useRoute()
const me = computed(() => org.me.value)
// the personal settings (`/account/*`) show the agency's shell too
const inAgency = computed(() => Boolean(route.params['org']))
// buttons drawn by the server do nothing until the page runs in the browser
const ready = useHydrated()
const many = computed(() => (me.value?.organizations.length ?? 0) > 1)
// the editor of a post is a page with no side bar and no shell rows: its own row at the top
// (screens 08 and 09)
// (screens 08 and 09); the page of a post's outcome keeps them (screen 13)
const outcomePage = usePostOutcomePage()
const editor = computed(() => route.meta['editor'] === true && !outcomePage.value)

// A suspension made by the platform must show without a reload: ask again who the person is
// when the tab comes back to the front (no more than once every 30 s, D-120.7) and when they move
// to another agency (at once).
const refresh = () => {
  if (document.visibilityState === 'visible') void session.reload()
}
onMounted(() => document.addEventListener('visibilitychange', refresh))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', refresh))
watch(org.slug, () => void session.load().catch(() => undefined))
const notice = useNotice()
</script>

<template>
  <div class="min-h-dvh bg-(--app-bg) md:flex">
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-(--app-surface) focus:px-3 focus:py-2"
    >
      {{ $t('a11y.skipToContent') }}
    </a>

    <AppSidebar v-if="!editor || !org.active.value" />

    <div class="min-w-0 flex-1">
      <!-- phone: one row at the top, the client selector and the bell (D-81) -->
      <header
        v-if="!editor || !org.active.value"
        class="sticky top-0 z-30 flex h-13 items-center gap-2 border-b border-(--app-border) bg-(--app-bg) ps-3 pe-2 md:hidden"
      >
        <ContextSwitcher v-if="org.active.value" variant="top" />
        <span class="flex-1" />
        <!-- the notifications open from the bell (Matteo, 14/11); the centre arrives in stage 8 -->
        <button
          v-if="org.active.value"
          type="button"
          aria-disabled="true"
          :aria-label="`${$t('agency.nav.notifications')} (${$t('client.soon')})`"
          :title="$t('client.soon')"
          class="flex size-11 shrink-0 items-center justify-center rounded-control text-(--app-text)"
        >
          <UIcon name="i-lucide-bell" class="size-5" aria-hidden="true" />
        </button>
        <!-- a suspended agency has no bar at the bottom: «Tu» stays reachable at the top -->
        <div v-else class="flex w-14 shrink-0"><UserMenu variant="tab" /></div>
      </header>

      <!-- the content is as wide as what is left, up to 1200 (PageShell); the margins of base.css -->
      <main
        id="main"
        class="w-full min-w-0"
        :class="editor && org.active.value ? '' : 'px-gutter pt-page-top pb-24 md:pb-16'"
      >
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
          <h1 id="suspended" class="text-title">{{ org.organization.value?.name }}</h1>
          <p role="alert">{{ $t('agencyHome.suspended') }}</p>
          <p v-if="many" class="text-(--app-text-muted)">{{ $t('agency.suspendedOthers') }}</p>
        </section>
      </main>
    </div>
    <!-- the editor of a post has its own bar at the bottom (design E3) -->
    <MobileNav v-if="org.active.value && !editor" />
    <!-- a confirmation that outlives the page it came from: «Programmato per …» (screen 12) -->
    <ClientOnly>
      <Toast
        v-model:open="notice.open.value"
        :message="notice.notice.value?.message ?? ''"
        :link-label="notice.notice.value?.linkLabel"
        :to="notice.notice.value?.to"
      />
    </ClientOnly>
    <!-- the uploads go on from page to page (D-21) -->
    <ClientOnly><UploadsDock v-if="inAgency" /></ClientOnly>
  </div>
</template>

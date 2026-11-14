<script setup lang="ts">
/**
 * Below 768 px: Home, Calendario, + (Nuovo post), Clienti, Tu (spec §11.11). Calendario and the
 * + show disabled with «Presto» until their pages exist (stages 5 and 6); who creates no posts
 * (a Viewer, §10.2) has no +. «Tu» opens the person's menu from the bottom.
 */
const org = useOrganization()
const route = useRoute()
const context = useContextQuery()
const { data: workspaces } = useWorkspaces()

// Owner and Admin create posts everywhere; anyone else in a client as more than a Viewer
const createsPosts = computed(
  () =>
    org.may.value.manageUsers ||
    (workspaces.value?.items ?? []).some((w) => !w.archivedAt && w.myRole !== 'viewer'),
)
const under = (to: string) => route.path === to || route.path.startsWith(`${to}/`)
const current = (to: string) => (to === org.to() ? route.path === to : under(to))

// the bar hides while the keyboard is open: the page shrinks well below the window
const keyboard = ref(false)
const onResize = () => {
  const view = window.visualViewport
  // a pinch zoom shrinks the visual viewport too: that is not the keyboard
  keyboard.value = Boolean(view && view.scale <= 1 && view.height < window.innerHeight * 0.75)
}
onMounted(() => window.visualViewport?.addEventListener('resize', onResize))
onBeforeUnmount(() => window.visualViewport?.removeEventListener('resize', onResize))

const place =
  'flex min-h-15 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-(--app-text-muted)'
</script>

<template>
  <nav
    v-show="!keyboard"
    :aria-label="$t('agency.nav.label')"
    class="fixed inset-x-0 bottom-0 z-40 border-t border-(--app-border) bg-(--app-surface) pb-[env(safe-area-inset-bottom)] md:hidden"
  >
    <ul :class="['grid', createsPosts ? 'grid-cols-5' : 'grid-cols-4']">
      <li class="flex">
        <NuxtLink
          :to="{ path: org.to(), query: context }"
          :aria-current="current(org.to()) ? 'page' : undefined"
          :class="[
            place,
            'aria-[current=page]:font-semibold aria-[current=page]:text-(--app-text)',
          ]"
        >
          <UIcon name="i-lucide-house" class="size-5" aria-hidden="true" />
          {{ $t('agency.nav.home') }}
        </NuxtLink>
      </li>
      <li class="flex">
        <span
          role="link"
          aria-disabled="true"
          :aria-label="`${$t('agency.nav.calendar')} (${$t('client.soon')})`"
          :class="place"
        >
          <span class="relative" aria-hidden="true">
            <UIcon name="i-lucide-calendar" class="size-5 opacity-60" />
            <span
              class="absolute -top-2 left-4 rounded-full border border-(--app-surface) bg-(--app-surface-sunken) px-1.5 text-[0.625rem] leading-4 font-medium text-(--app-text-muted)"
              >{{ $t('client.soon') }}</span
            >
          </span>
          <span class="opacity-60" aria-hidden="true">{{ $t('agency.nav.calendar') }}</span>
        </span>
      </li>
      <li v-if="createsPosts" class="flex">
        <span
          role="link"
          aria-disabled="true"
          :aria-label="`${$t('client.newPost')} (${$t('client.soon')})`"
          :class="place"
        >
          <span
            class="flex size-10 items-center justify-center rounded-full border-[1.5px] border-(--app-text) bg-(--app-brand) text-(--app-text) opacity-45 dark:text-[#242321]"
            aria-hidden="true"
          >
            <UIcon name="i-lucide-plus" class="size-5" />
          </span>
          <span class="text-[0.625rem] leading-3" aria-hidden="true">{{ $t('client.soon') }}</span>
        </span>
      </li>
      <li class="flex">
        <NuxtLink
          :to="{ path: org.to('/spazi'), query: context }"
          :aria-current="current(org.to('/spazi')) ? 'page' : undefined"
          :class="[
            place,
            'aria-[current=page]:font-semibold aria-[current=page]:text-(--app-text)',
          ]"
        >
          <UIcon name="i-lucide-briefcase" class="size-5" aria-hidden="true" />
          {{ $t('agency.nav.workspaces') }}
        </NuxtLink>
      </li>
      <li class="flex">
        <UserMenu variant="tab" />
      </li>
    </ul>
  </nav>
</template>

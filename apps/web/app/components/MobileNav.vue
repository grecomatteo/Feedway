<script setup lang="ts">
/**
 * Below 768 px (D-81, `base.css` `.m-nav`): Oggi, Calendario, + (Nuovo post), Clienti, Tu (spec
 * §11.11). Calendario stays off until its page exists (stage 9); who creates no posts (a Viewer,
 * §10.2) has no +. «Tu» opens the person's menu from the bottom, with Libreria, Utenti and
 * Impostazioni: it is the current place on those pages.
 */
const org = useOrganization()
const route = useRoute()
const context = useContextQuery()
const newPost = useNewPost()

// the + of the bar is drawn heavier than the other icons (base.css `.m-nav .plus svg`)
const bold = (content: string) =>
  content.replaceAll(/stroke-width="[\d.]+"/g, 'stroke-width="2.25"')

const under = (to: string) => route.path === to || route.path.startsWith(`${to}/`)
const current = (to: string) => (to === org.to() ? route.path === to : under(to))
const inYou = computed(
  () =>
    ['/libreria', '/utenti', '/impostazioni'].some((p) => under(org.to(p))) || under('/account'),
)

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
  'flex h-[59px] flex-1 flex-col items-center justify-center gap-[3px] text-[11px] leading-[14px] font-medium text-(--app-text-muted) aria-[current=page]:font-semibold aria-[current=page]:text-(--app-text)'
</script>

<template>
  <nav
    v-show="!keyboard"
    :aria-label="$t('agency.nav.label')"
    class="fixed inset-x-0 bottom-0 z-40 border-t border-(--app-border) bg-(--app-surface) pb-[env(safe-area-inset-bottom)] md:hidden"
  >
    <ul :class="['grid', newPost.allowed.value ? 'grid-cols-5' : 'grid-cols-4']">
      <li class="flex">
        <NuxtLink
          :to="{ path: org.to(), query: context }"
          :aria-current="current(org.to()) ? 'page' : undefined"
          :class="place"
        >
          <UIcon name="i-lucide-sun" class="size-[21px]" aria-hidden="true" />
          {{ $t('agency.nav.home') }}
        </NuxtLink>
      </li>
      <li class="flex">
        <NuxtLink
          :to="{ path: org.to('/calendario'), query: context }"
          :aria-current="current(org.to('/calendario')) ? 'page' : undefined"
          :class="place"
        >
          <UIcon name="i-lucide-calendar-days" class="size-[21px]" aria-hidden="true" />
          {{ $t('agency.nav.calendar') }}
        </NuxtLink>
      </li>
      <li v-if="newPost.allowed.value" class="flex">
        <NuxtLink :to="newPost.link.value" :aria-label="$t('client.newPost')" :class="place">
          <span
            class="flex h-9 w-11 items-center justify-center rounded-[10px] bg-(--app-brand) text-(--app-on-brand)"
            aria-hidden="true"
          >
            <Icon name="i-lucide-plus" class="size-[22px]" :customize="bold" />
          </span>
        </NuxtLink>
      </li>
      <li class="flex">
        <NuxtLink
          :to="{ path: org.to('/spazi'), query: context }"
          :aria-current="current(org.to('/spazi')) ? 'page' : undefined"
          :class="place"
        >
          <UIcon name="i-lucide-briefcase-business" class="size-[21px]" aria-hidden="true" />
          {{ $t('agency.nav.workspaces') }}
        </NuxtLink>
      </li>
      <li class="flex">
        <UserMenu variant="tab" :current="inYou" />
      </li>
    </ul>
  </nav>
</template>

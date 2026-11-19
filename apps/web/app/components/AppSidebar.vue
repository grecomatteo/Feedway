<script setup lang="ts">
/**
 * The sidebar of the panel (D-81, `base.css` `.side`), 240 wide on a computer: the logo and the
 * bell, the client selector, «Nuovo post» always there, then Oggi, Calendario, Clienti, Libreria;
 * under the agency's name Utenti and Impostazioni; the person at the bottom.
 */
const org = useOrganization()
const nav = useAgencyNav()
const context = useContextQuery()
const route = useRoute()
const newPost = useNewPost()
const inAgency = computed(() => Boolean(route.params['org']))
// beside «Oggi», how many things need a hand: the same read as «Da sistemare» (redesign R3), for
// the client of the selector or for all of them
const { workspace } = useActiveContext()
const issues = useAgendaIssues()
const toFix = computed(() =>
  inAgency.value ? issuesOf(issues.data.value?.items ?? [], workspace.value?.id ?? null).length : 0,
)

const main = computed(() => nav.value.filter((item) => item.group === 'main'))
const agency = computed(() => nav.value.filter((item) => item.group === 'agency'))
// Impostazioni holds the person's and the agency's settings, and the pages reached from them
const SETTINGS = ['/account', '/impostazioni', '/registro', '/privacy']
const under = (path: string, to: string) => path === to || path.startsWith(`${to}/`)
const current = (to: string) => {
  const path = route.path
  if (to === org.to()) return path === to
  if (to === '/account')
    return SETTINGS.some((s) => under(path, s.startsWith('/account') ? s : org.to(s)))
  return under(path, to)
}
const entry =
  'flex h-9 items-center gap-2.5 rounded-control px-2.5 font-medium text-(--app-text-muted) transition-colors duration-150 hover:bg-(--app-nav-hover) hover:text-(--app-text) aria-[current=page]:bg-(--app-nav-hover) aria-[current=page]:font-semibold aria-[current=page]:text-(--app-text)'
</script>

<template>
  <aside
    class="sticky top-0 hidden h-dvh w-sidebar shrink-0 flex-col self-start overflow-y-auto border-e border-(--app-border) bg-(--app-nav-bg) p-3 md:flex"
  >
    <div class="flex items-center justify-between ps-2 pe-1 pt-1.5 pb-3.5">
      <NuxtLink
        :to="{ path: org.to(), query: context }"
        class="-ms-1 flex rounded-control"
        :aria-label="$t('agency.nav.home')"
        ><BrandLogo size="bar"
      /></NuxtLink>
      <!-- the notifications open from the bell (Matteo, 14/11); the centre arrives in stage 8 -->
      <button
        v-if="org.active.value"
        type="button"
        aria-disabled="true"
        :aria-label="`${$t('agency.nav.notifications')} (${$t('client.soon')})`"
        :title="$t('client.soon')"
        class="flex size-control-sm items-center justify-center rounded-control text-(--app-text) hover:bg-(--app-nav-hover)"
      >
        <UIcon name="i-lucide-bell" class="size-4" aria-hidden="true" />
      </button>
    </div>

    <template v-if="org.active.value">
      <!-- the personal settings have no client context of their own (D-87) -->
      <ContextSwitcher v-if="inAgency" />
      <UButton
        v-if="newPost.allowed.value"
        :to="newPost.link.value"
        icon="i-lucide-plus"
        block
        class="font-semibold"
        >{{ $t('client.newPost') }}</UButton
      >

      <nav :aria-label="$t('agency.nav.label')" class="mt-3 flex flex-col gap-0.5">
        <NuxtLink
          v-for="item in main.slice(0, 1)"
          :key="item.to"
          :to="item.link"
          :aria-current="current(item.to) ? 'page' : undefined"
          :class="entry"
        >
          <UIcon :name="item.icon" class="size-[18px] shrink-0" aria-hidden="true" />
          {{ $t(item.label) }}
          <span
            v-if="toFix > 0"
            class="ms-auto h-5 min-w-5 rounded-full bg-(--app-brand) px-1.5 text-center text-caption leading-5 font-semibold text-(--app-on-brand) tabular-nums"
            data-count
            ><span aria-hidden="true">{{ toFix }}</span
            ><span class="sr-only">{{ $t('today.issues.count', { n: toFix }, toFix) }}</span></span
          >
        </NuxtLink>
        <!-- the calendar arrives in stage 9: in its place, off -->
        <span
          role="link"
          aria-disabled="true"
          :aria-label="`${$t('agency.nav.calendar')} (${$t('client.soon')})`"
          :class="[entry, 'cursor-default hover:bg-transparent hover:text-(--app-text-muted)']"
        >
          <UIcon name="i-lucide-calendar-days" class="size-[18px] shrink-0" aria-hidden="true" />
          <span aria-hidden="true">{{ $t('agency.nav.calendar') }}</span>
          <span
            class="ms-auto rounded-[4px] border border-(--app-border-strong) px-[5px] text-[11px] leading-4 font-medium text-(--app-text-muted)"
            aria-hidden="true"
            >{{ $t('client.soon') }}</span
          >
        </span>
        <NuxtLink
          v-for="item in main.slice(1)"
          :key="item.to"
          :to="item.link"
          :aria-current="current(item.to) ? 'page' : undefined"
          :class="entry"
        >
          <UIcon :name="item.icon" class="size-[18px] shrink-0" aria-hidden="true" />
          {{ $t(item.label) }}
        </NuxtLink>

        <p class="truncate px-2.5 pt-4 pb-1.5 text-caption text-(--app-text-muted)">
          {{ org.organization.value?.name }}
        </p>
        <NuxtLink
          v-for="item in agency"
          :key="item.to"
          :to="item.link"
          :aria-current="current(item.to) ? 'page' : undefined"
          :class="entry"
        >
          <UIcon :name="item.icon" class="size-[18px] shrink-0" aria-hidden="true" />
          {{ $t(item.label) }}
        </NuxtLink>
      </nav>
    </template>

    <div class="-mx-3 mt-auto border-t border-(--app-border) px-3 pt-1">
      <UserMenu />
    </div>
  </aside>
</template>

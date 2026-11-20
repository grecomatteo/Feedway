<script setup lang="ts">
/**
 * The client's page (spec §14.7, screens 16–18 of the new direction): the «home» of a client,
 * where the selector leads (D-5). At the top its square picture, name and the names of its profiles
 * on one line («Nuovo post» is the shell's, which already writes for this client); then the tabs
 * Panoramica, Post, Libreria, Persone and Contenuti. The tabs are child pages: Panoramica is `index.vue`,
 * Post `post/index.vue` (its editor `post/[postId].vue`), Libreria `libreria.vue`, Persone `membri.vue`,
 * Impostazioni dei contenuti `contenuti.vue`.
 */
definePageMeta({ layout: 'agency' })

const org = useOrganization()
const route = useRoute()
const { t } = useI18n()
const { client, missing, profiles } = useClientPage()

useHead({ title: () => client.value?.name ?? t('client.title') })

const list = computed(() => instagramFirst(profiles.data.value?.items ?? []))
const photo = computed(() => {
  for (const p of list.value) {
    const found = profilePhoto(p)
    if (found) return found
  }
  return client.value?.photoUrl ?? null
})

const handleOf = (a: ProfileAccount) =>
  a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
/** A profile by its name on the platform: its Instagram, else its only account (§3). */
const mainOf = (p: WorkspaceProfile) =>
  (p.accounts.find((a) => a.platform === 'instagram') ?? p.accounts[0]) as ProfileAccount

const base = computed(() => org.to(`/spazi/${encodeURIComponent(String(route.params['slug']))}`))
// the profile chosen in the selector follows from tab to tab
const keep = computed(() => {
  const profilo = route.query['profilo']
  return typeof profilo === 'string' && profilo !== '' ? { profilo } : {}
})
// the library from Editor up (§10.2): for a Viewer the tab is not there
const tabs = computed(() => [
  { key: 'overview', to: base.value, label: t('client.tabs.overview') },
  // until the calendar (stage 9) the posts are a list, in the tab «Post» (plan 06 Scelta 6)
  { key: 'posts', to: `${base.value}/post`, label: t('client.tabs.posts') },
  ...(client.value && usesLibrary(client.value)
    ? [{ key: 'library', to: `${base.value}/libreria`, label: t('client.tabs.library') }]
    : []),
  { key: 'people', to: `${base.value}/membri`, label: t('client.tabs.people') },
  // labels, templates, groups and the default time: who manages the client (plan 06 Task 7)
  ...(client.value && ['owner', 'admin', 'manager'].includes(client.value.myRole)
    ? [{ key: 'content', to: `${base.value}/contenuti`, label: t('client.tabs.content') }]
    : []),
])
const current = (to: string) => route.path === to || route.path === `${to}/`
// the editor of a post is a page of its own, with no head nor tabs of the client (design E1)
const bare = computed(() => route.meta['editor'] === true)
</script>

<template>
  <!-- the editor draws its whole page, edge to edge (screens 08 and 09) -->
  <NuxtPage v-if="bare && !missing" />
  <PageShell v-else>
    <p v-if="missing" role="alert" class="space-y-3">
      <span class="block">{{ $t('workspaceMembers.missing') }}</span>
      <NuxtLink :to="org.to('/spazi')" class="underline">{{ $t('client.backToClients') }}</NuxtLink>
    </p>
    <template v-if="!missing" #head>
      <div data-client-head>
        <header class="mb-4 flex min-w-0 items-center gap-3.5 max-md:mb-3">
          <span
            v-if="!client"
            class="size-10 shrink-0 animate-pulse rounded-[10px] bg-(--app-surface-sunken)"
            aria-hidden="true"
          />
          <Avatar v-else :name="client.name" :src="photo" :size="40" />
          <h1 class="min-w-0 truncate">
            <span v-if="client">{{ client.name }}</span>
            <span
              v-else
              class="inline-flex h-7 w-48 animate-pulse rounded-md bg-(--app-surface-sunken)"
              ><span class="sr-only">{{ $t('client.title') }}</span></span
            >
          </h1>
          <UBadge v-if="client?.archivedAt" color="neutral" variant="subtle" class="shrink-0">
            {{ $t('client.archived') }}
          </UBadge>
          <p
            v-if="client && list.length > 0"
            class="flex min-w-0 items-center gap-3.5 overflow-hidden max-md:hidden"
            data-client-handles
          >
            <span v-for="p in list" :key="p.key" class="inline-flex min-w-0 items-center">
              <PlatformIcons
                :platforms="[mainOf(p).platform]"
                :label="handleOf(mainOf(p))"
                class="min-w-0"
              />
            </span>
          </p>
        </header>

        <!-- the line under the tabs is a shadow, not a border the tabs overlap: with overflow-x the
           overlap made a vertical scrollbar appear beside them (R-10) -->
        <nav
          :aria-label="$t('client.tabs.label')"
          class="overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--app-border)] max-md:-mx-gutter max-md:px-gutter"
        >
          <ul class="flex min-w-max gap-1">
            <li v-for="tab in tabs" :key="tab.key">
              <NuxtLink
                :to="{ path: tab.to, query: keep }"
                :aria-current="current(tab.to) ? 'page' : undefined"
                class="relative flex h-[38px] items-center px-3 font-medium whitespace-nowrap text-(--app-text-muted) hover:text-(--app-text) aria-[current=page]:font-semibold aria-[current=page]:text-(--app-text) max-md:h-11"
              >
                {{ tab.label }}
                <span
                  v-if="current(tab.to)"
                  class="absolute inset-x-3 bottom-0 h-0.5 bg-(--app-brand)"
                  aria-hidden="true"
                  data-accent
                />
              </NuxtLink>
            </li>
          </ul>
        </nav>
      </div>
    </template>

    <NuxtPage v-if="!missing" />
  </PageShell>
</template>

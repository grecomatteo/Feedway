<script setup lang="ts">
/**
 * The client's page (spec §14.7, plan 04 Task 6a): the «home» of a client, where the selector
 * leads (D-5). At the top its photo, name, the names of its profiles and «Nuovo post»; then the
 * tabs Panoramica, Calendario, Libreria and Persone, «Presto» on those not built yet. The tabs are
 * child pages: Panoramica is `index.vue`, Persone `membri.vue`.
 */
definePageMeta({ layout: 'agency' })

const org = useOrganization()
const route = useRoute()
const { t } = useI18n()
const { client, missing, profiles } = useClientPage()

useHead({ title: () => client.value?.name ?? t('client.title') })

const list = computed(() => profiles.data.value?.items ?? [])
const photo = computed(() => {
  for (const p of list.value) {
    const found = profilePhoto(p)
    if (found) return found
  }
  return client.value?.photoUrl ?? null
})

const PLATFORM_ICON: Record<string, string> = {
  instagram: 'i-lucide-instagram',
  facebook: 'i-lucide-facebook',
}
const iconOf = (platform: string) => PLATFORM_ICON[platform] ?? 'i-lucide-at-sign'
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
const tabs = computed(() => [
  { key: 'overview', to: base.value, label: t('client.tabs.overview') },
  { key: 'calendar', to: null, label: t('client.tabs.calendar') },
  { key: 'library', to: null, label: t('client.tabs.library') },
  { key: 'people', to: `${base.value}/membri`, label: t('client.tabs.people') },
])
const current = (to: string) => route.path === to || route.path === `${to}/`
</script>

<template>
  <div>
    <p v-if="missing" role="alert" class="space-y-3">
      <span class="block">{{ $t('workspaceMembers.missing') }}</span>
      <NuxtLink :to="org.to('/spazi')" class="underline">{{ $t('client.backToClients') }}</NuxtLink>
    </p>
    <template v-else>
      <header class="mb-5 flex flex-wrap items-start gap-4">
        <span
          v-if="!client"
          class="size-14 shrink-0 animate-pulse rounded-full bg-(--app-surface-sunken)"
          aria-hidden="true"
        />
        <RowAvatar v-else :name="client.name" :src="photo" size="page" />
        <div class="min-w-0 flex-1">
          <h1 class="text-[1.625rem] leading-tight break-words md:text-[1.875rem]">
            <span v-if="client">{{ client.name }}</span>
            <span
              v-else
              class="inline-block h-8 w-48 animate-pulse rounded-md bg-(--app-surface-sunken)"
              ><span class="sr-only">{{ $t('client.title') }}</span></span
            >
          </h1>
          <p
            v-if="client"
            class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-(--app-text-muted)"
          >
            <UBadge v-if="client.archivedAt" color="neutral" variant="subtle">
              {{ $t('client.archived') }}
            </UBadge>
            <template v-if="list.length > 0">
              <span v-for="p in list" :key="p.key" class="inline-flex min-w-0 items-center gap-1">
                <UIcon
                  :name="iconOf(mainOf(p).platform)"
                  class="size-[0.9375rem] shrink-0"
                  aria-hidden="true"
                />
                <span class="sr-only"
                  >{{ $t(`socialAccounts.platform.${mainOf(p).platform}`) }}:</span
                >
                <span class="truncate">{{ handleOf(mainOf(p)) }}</span>
              </span>
            </template>
            <span v-else-if="profiles.data.value">{{ $t('workspaces.noProfile') }}</span>
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2 self-center">
          <!-- the editor arrives in stage 6 -->
          <UButton
            class="min-h-11"
            icon="i-lucide-plus"
            disabled
            :aria-label="`${$t('client.newPost')} (${$t('client.soon')})`"
          >
            <span class="max-sm:hidden">{{ $t('client.newPost') }}</span>
            <span
              class="rounded-full bg-(--app-surface) px-2 text-xs font-medium text-(--app-text-muted) max-sm:hidden"
              aria-hidden="true"
              >{{ $t('client.soon') }}</span
            >
          </UButton>
        </div>
      </header>

      <nav
        :aria-label="$t('client.tabs.label')"
        class="-mx-4 mb-6 overflow-x-auto border-b border-(--app-border) px-4 sm:mx-0 sm:px-0"
      >
        <ul class="flex min-w-max gap-1">
          <li v-for="tab in tabs" :key="tab.key">
            <NuxtLink
              v-if="tab.to"
              :to="{ path: tab.to, query: keep }"
              :aria-current="current(tab.to) ? 'page' : undefined"
              class="-mb-px flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm max-sm:px-2.5 text-(--app-text-muted) hover:text-(--app-text) aria-[current=page]:border-(--app-brand) aria-[current=page]:font-semibold aria-[current=page]:text-(--app-text)"
            >
              {{ tab.label }}
            </NuxtLink>
            <span
              v-else
              aria-disabled="true"
              class="-mb-px flex min-h-11 cursor-default items-center gap-1.5 border-b-2 border-transparent px-3 text-sm text-(--app-text-muted) max-sm:px-2.5 max-sm:opacity-70"
            >
              {{ tab.label }}
              <span
                class="rounded-full bg-(--app-surface-sunken) px-1.5 text-[0.6875rem] font-medium text-(--app-text-muted) max-sm:sr-only"
                >{{ $t('client.soon') }}</span
              >
            </span>
          </li>
        </ul>
      </nav>

      <NuxtPage />
    </template>
  </div>
</template>

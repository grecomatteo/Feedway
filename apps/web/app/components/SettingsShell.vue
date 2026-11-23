<script setup lang="ts">
/**
 * One «Impostazioni» for everything (Matteo, 13/11; screens 23–26): the person's own pages and,
 * for who may see them, the agency's, in a menu on the left; below 1024 px (a phone, a tablet, a
 * narrow window beside the side bar) the menu is a drop-down above the page (D-120.8). The addresses stay where they were (`/account/*`, `/<agenzia>/impostazioni/*`),
 * so the links in the emails keep working; only the shell around them is shared. `wide` lets the
 * page use the whole width (a table: Integrazioni, Registro attività), otherwise it stops at 720.
 */
withDefaults(defineProps<{ wide?: boolean }>(), { wide: false })
const route = useRoute()
const org = useOrganization()
const { t } = useI18n()

interface Tab {
  to: string
  label: string
  icon: string
}
const groups = computed(() => {
  const list: { id: string; label: string; tabs: Tab[] }[] = [
    {
      id: 'settings-mine',
      label: t('settings.groups.mine'),
      tabs: [
        { to: '/account', label: t('account.tabs.profile'), icon: 'i-lucide-user' },
        { to: '/account/sicurezza', label: t('account.tabs.security'), icon: 'i-lucide-shield' },
        {
          to: '/account/dispositivi',
          label: t('account.tabs.devices'),
          icon: 'i-lucide-monitor-smartphone',
        },
        { to: '/account/privacy', label: t('account.tabs.privacy'), icon: 'i-lucide-lock' },
      ],
    },
  ]
  if (!org.active.value) return list
  const tabs: Tab[] = [
    ...(org.may.value.viewSettings
      ? [
          {
            to: org.to('/impostazioni'),
            label: t('orgSettings.tabs.general'),
            icon: 'i-lucide-building',
          },
          {
            to: org.to('/impostazioni/integrazioni'),
            label: t('orgSettings.tabs.integrations'),
            icon: 'i-lucide-plug',
          },
        ]
      : []),
    ...(org.may.value.viewAudit
      ? [
          {
            to: org.to('/impostazioni/registro'),
            label: t('agency.nav.audit'),
            icon: 'i-lucide-scroll-text',
          },
        ]
      : []),
  ]
  if (tabs.length > 0)
    list.push({
      id: 'settings-agency',
      label: org.organization.value?.name ?? t('settings.groups.agency'),
      tabs,
    })
  return list
})
/** The tab of this page: the longest one it is under (Integrazioni → Meta is still Integrazioni). */
const current = computed(() => {
  const under = (to: string) => route.path === to || route.path.startsWith(`${to}/`)
  return (
    groups.value
      .flatMap((g) => g.tabs.map((tab) => tab.to))
      .filter(under)
      .sort((a, b) => b.length - a.length)[0] ?? null
  )
})
const currentTab = computed(() =>
  groups.value.flatMap((g) => g.tabs).find((tab) => tab.to === current.value),
)
const menu = computed(() =>
  groups.value.map((g) => [
    { type: 'label' as const, label: g.label },
    ...g.tabs.map((tab) => ({ label: tab.label, icon: tab.icon, to: tab.to })),
  ]),
)
</script>

<template>
  <PageShell>
    <template #head>
      <PageHeader :title="$t('settings.title')" />
    </template>

    <div
      class="grid gap-12 max-lg:block"
      :class="wide ? 'lg:grid-cols-[208px_minmax(0,1fr)]' : 'lg:grid-cols-[208px_minmax(0,720px)]'"
      data-settings
    >
      <nav :aria-label="$t('settings.title')" class="grid content-start gap-0.5 max-lg:hidden">
        <template v-for="(group, g) in groups" :key="group.id">
          <p
            :id="group.id"
            class="px-2.5 pb-1.5 text-caption text-(--app-text-muted)"
            :class="g === 0 ? '' : 'pt-4'"
          >
            {{ group.label }}
          </p>
          <ul :aria-labelledby="group.id" class="grid gap-0.5">
            <li v-for="tab in group.tabs" :key="tab.to">
              <NuxtLink
                :to="tab.to"
                :aria-current="current === tab.to ? 'page' : undefined"
                class="flex h-[34px] items-center gap-2.5 rounded-control px-2.5 font-medium text-(--app-text-muted) transition-colors duration-150 hover:bg-(--app-nav-hover) hover:text-(--app-text) aria-[current=page]:bg-(--app-nav-hover) aria-[current=page]:font-semibold aria-[current=page]:text-(--app-text)"
              >
                <UIcon :name="tab.icon" class="size-4 shrink-0" aria-hidden="true" />
                {{ tab.label }}
              </NuxtLink>
            </li>
          </ul>
        </template>
      </nav>

      <div class="min-w-0">
        <UDropdownMenu
          :items="menu"
          :content="{ align: 'start' }"
          :ui="{ content: 'w-(--reka-dropdown-menu-trigger-width)' }"
        >
          <button
            type="button"
            class="mb-5 flex h-11 w-full items-center gap-2 rounded-control border border-(--app-field-border) bg-(--app-surface) px-3 text-left md:max-w-sm lg:hidden"
            :aria-label="$t('settings.pick', { page: currentTab?.label ?? '' })"
            data-settings-pick
          >
            <UIcon
              v-if="currentTab"
              :name="currentTab.icon"
              class="size-4 shrink-0 text-(--app-text-muted)"
              aria-hidden="true"
            />
            <span class="flex-1 truncate">{{ currentTab?.label }}</span>
            <UIcon
              name="i-lucide-chevron-down"
              class="size-4 shrink-0 text-(--app-text-muted)"
              aria-hidden="true"
            />
          </button>
        </UDropdownMenu>
        <div class="flex flex-col gap-8">
          <slot />
        </div>
      </div>
    </div>
  </PageShell>
</template>

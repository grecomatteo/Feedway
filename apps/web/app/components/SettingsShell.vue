<script setup lang="ts">
/**
 * One «Impostazioni» for everything (Matteo, 13/11): the person's own pages and, for who may see
 * them, the agency's. The addresses stay where they were (`/account/*`, `/<agenzia>/impostazioni/*`),
 * so the links in the emails keep working; only the shell around them is shared. The agency is the
 * one of the address, or the one remembered outside it; its group shows only to who may see it
 * (`organization.settings.view`).
 */
const route = useRoute()
const org = useOrganization()

const groups = computed(() => {
  const list = [
    {
      id: 'settings-mine',
      label: 'settings.groups.mine',
      tabs: [
        { to: '/account', label: 'account.tabs.profile' },
        { to: '/account/sicurezza', label: 'account.tabs.security' },
        { to: '/account/dispositivi', label: 'account.tabs.devices' },
        { to: '/account/privacy', label: 'account.tabs.privacy' },
      ],
    },
  ]
  if (org.active.value && org.may.value.viewSettings)
    list.push({
      id: 'settings-agency',
      label: 'settings.groups.agency',
      tabs: [
        { to: org.to('/impostazioni'), label: 'orgSettings.tabs.general' },
        { to: org.to('/impostazioni/integrazioni'), label: 'orgSettings.tabs.integrations' },
      ],
    })
  return list
})
const agencyName = computed(() => org.organization.value?.name ?? '')
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-3xl">{{ $t('settings.title') }}</h1>
      <!-- whose settings these are, or what the person may change -->
      <slot name="intro" />
    </header>

    <div
      class="space-y-6 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:items-start lg:gap-8 lg:space-y-0"
    >
      <nav :aria-label="$t('settings.title')" class="space-y-4 lg:sticky lg:top-6">
        <div v-for="group in groups" :key="group.id" class="space-y-1.5">
          <p :id="group.id" class="px-1 text-xs font-semibold text-(--app-text-muted)">
            {{ $t(group.label) }}
            <span v-if="group.id === 'settings-agency' && agencyName" class="font-normal"
              >· {{ agencyName }}</span
            >
          </p>
          <ul
            :aria-labelledby="group.id"
            class="grid grid-cols-2 gap-1 rounded-lg bg-(--app-surface-sunken) p-1 sm:flex sm:flex-wrap lg:flex-col lg:flex-nowrap lg:bg-transparent lg:p-0"
          >
            <li v-for="tab in group.tabs" :key="tab.to">
              <NuxtLink
                :to="tab.to"
                :aria-current="route.path === tab.to ? 'page' : undefined"
                class="flex min-h-11 items-center rounded-md px-3 text-sm text-(--app-text-muted) hover:text-(--app-text) aria-[current=page]:bg-(--app-surface) aria-[current=page]:font-semibold aria-[current=page]:text-(--app-text) lg:hover:bg-(--app-surface-sunken) lg:aria-[current=page]:bg-(--app-brand-soft)"
              >
                {{ $t(tab.label) }}
              </NuxtLink>
            </li>
          </ul>
        </div>
      </nav>

      <div class="min-w-0 space-y-6">
        <slot />
      </div>
    </div>
  </div>
</template>

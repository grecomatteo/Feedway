<script setup lang="ts">
// the menu opens only once the page runs in the browser: a click before that would be lost
const ready = useHydrated()
/**
 * The agency at the top of the sidebar: its logo (or the tile with its initials) and its name.
 * With more than one agency the row opens the list; no arrows, a light background on hover.
 */
const org = useOrganization()
const others = computed(() => org.me.value?.organizations ?? [])
const name = computed(() => org.organization.value?.name ?? '')
const logo = computed(() => org.organization.value?.logoUrl ?? null)
const items = computed(() =>
  others.value.map((o) => ({
    label: o.name,
    type: 'checkbox' as const,
    checked: o.slug === org.slug.value,
    onSelect: () => navigateTo(`/${o.slug}`),
  })),
)
const row = 'flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-start'
</script>

<template>
  <UDropdownMenu v-if="others.length > 1" :items="items" :ui="{ content: 'min-w-60' }">
    <button
      type="button"
      :disabled="!ready"
      :class="[
        row,
        'transition-colors duration-150 hover:bg-(--app-nav-hover) aria-expanded:bg-(--app-nav-hover)',
      ]"
    >
      <AgencyLogo :name="name" :src="logo" />
      <span class="truncate text-sm font-semibold"
        ><span class="sr-only">{{ $t('agency.switcher') }}: </span>{{ name }}</span
      >
    </button>
  </UDropdownMenu>
  <p v-else :class="row">
    <AgencyLogo :name="name" :src="logo" />
    <span class="truncate text-sm font-semibold">{{ name }}</span>
  </p>
</template>

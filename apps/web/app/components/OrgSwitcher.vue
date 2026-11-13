<script setup lang="ts">
// the menu opens only once the page runs in the browser: a click before that would be lost
const ready = useHydrated()
/**
 * The agency at the top of the sidebar: its tile (initials until the logo arrives) and its name.
 * With more than one agency the row opens the list; no arrows, a light background on hover.
 */
const org = useOrganization()
const others = computed(() => org.me.value?.organizations ?? [])
const name = computed(() => org.organization.value?.name ?? '')
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
      :aria-label="$t('agency.switcher')"
      :class="[
        row,
        'transition-colors duration-150 hover:bg-(--app-nav-hover) aria-expanded:bg-(--app-nav-hover)',
      ]"
    >
      <RowAvatar :name="name" shape="square" />
      <span class="truncate text-sm font-semibold">{{ name }}</span>
    </button>
  </UDropdownMenu>
  <p v-else :class="row">
    <RowAvatar :name="name" shape="square" />
    <span class="truncate text-sm font-semibold">{{ name }}</span>
  </p>
</template>

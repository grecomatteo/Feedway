<script setup lang="ts">
// the menu opens only once the page runs in the browser: a click before that would be lost
const ready = useHydrated()
/** The person's other agencies, only when they have more than one. */
const org = useOrganization()
const others = computed(() => org.me.value?.organizations ?? [])
const items = computed(() =>
  others.value.map((o) => ({
    label: o.name,
    type: 'checkbox' as const,
    checked: o.slug === org.slug.value,
    onSelect: () => navigateTo(`/${o.slug}`),
  })),
)
</script>

<template>
  <UDropdownMenu v-if="others.length > 1" :items="items">
    <UButton
      :disabled="!ready"
      color="neutral"
      variant="ghost"
      class="min-h-11 w-full justify-between"
      trailing-icon="i-lucide-chevrons-up-down"
      :aria-label="$t('agency.switcher')"
    >
      <span class="truncate">{{ org.organization.value?.name }}</span>
    </UButton>
  </UDropdownMenu>
  <p v-else class="flex min-h-11 items-center truncate px-2.5 text-sm font-semibold">
    {{ org.organization.value?.name }}
  </p>
</template>

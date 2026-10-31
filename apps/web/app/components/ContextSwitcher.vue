<script setup lang="ts">
// the menu opens only once the page runs in the browser: a click before that would be lost
const ready = useHydrated()
/**
 * "Tutti i clienti" or one workspace the person sees, kept in the address (`?spazio=`). A slug
 * that is unknown and one of a workspace the person does not see end up the same way.
 */
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { data } = useWorkspaces()

const visible = computed(() => (data.value?.items ?? []).filter((w) => w.archivedAt === null))
const current = computed(() => {
  const asked = route.query['spazio']
  return typeof asked === 'string' ? (visible.value.find((w) => w.slug === asked) ?? null) : null
})
const label = computed(() => current.value?.name ?? t('context.all'))
const pick = (slug: string | null) => {
  const query = { ...route.query }
  if (slug === null) delete query['spazio']
  else query['spazio'] = slug
  void router.replace({ query })
}
const items = computed(() => [
  {
    label: t('context.all'),
    type: 'checkbox' as const,
    checked: current.value === null,
    onSelect: () => pick(null),
  },
  ...visible.value.map((w) => ({
    label: w.name,
    type: 'checkbox' as const,
    checked: current.value?.id === w.id,
    onSelect: () => pick(w.slug),
  })),
])
</script>

<template>
  <UDropdownMenu :items="items">
    <UButton
      :disabled="!ready"
      color="neutral"
      variant="outline"
      class="min-h-11 w-full justify-between"
      trailing-icon="i-lucide-chevrons-up-down"
      :aria-label="$t('context.label')"
    >
      <span class="truncate">{{ label }}</span>
    </UButton>
  </UDropdownMenu>
</template>

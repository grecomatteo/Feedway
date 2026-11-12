<script setup lang="ts">
// the menu opens only once the page runs in the browser: a click before that would be lost
const ready = useHydrated()
/**
 * "Tutti i clienti", one workspace the person sees, or one profile of that workspace (§14.6),
 * kept in the address (`?spazio=`, `&profilo=`). What is unknown or not visible falls back to
 * "Tutti i clienti" (useActiveContext).
 */
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { visible, workspace, profile, profiles } = useActiveContext()

const label = computed(() => {
  if (!workspace.value) return t('context.all')
  return profile.value
    ? t('context.profileOf', {
        workspace: workspace.value.name,
        profile: profileName(profile.value),
      })
    : workspace.value.name
})
const pick = (slug: string | null, profileId: string | null = null) => {
  const query = { ...route.query }
  delete query['profilo']
  if (slug === null) delete query['spazio']
  else query['spazio'] = slug
  if (profileId !== null) query['profilo'] = profileId
  void router.replace({ query })
}
const items = computed(() => [
  {
    label: t('context.all'),
    type: 'checkbox' as const,
    checked: workspace.value === null,
    onSelect: () => pick(null),
  },
  ...visible.value.flatMap((w) => [
    {
      label: w.name,
      type: 'checkbox' as const,
      checked: workspace.value?.id === w.id && profile.value === null,
      onSelect: () => pick(w.slug),
    },
    // the profiles of the workspace in context, right under it
    ...(workspace.value?.id === w.id
      ? (profiles.data.value?.items ?? []).map((p) => ({
          label: t('context.profile', { name: profileName(p) }),
          type: 'checkbox' as const,
          checked: profile.value?.key === p.key,
          class: 'ps-6',
          onSelect: () => pick(w.slug, p.id),
        }))
      : []),
  ]),
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

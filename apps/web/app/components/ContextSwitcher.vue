<script setup lang="ts">
// the menu opens only once the page runs in the browser: a click before that would be lost
const ready = useHydrated()
/**
 * "Tutti i clienti", one workspace the person sees, or one profile of that workspace (§14.6),
 * kept in the address (`?spazio=`, `&profilo=`). What is unknown or not visible falls back to
 * "Tutti i clienti" (useActiveContext). A clean row like the agency's and the person's: the
 * client's photo (its Instagram's, else its Page's) or its initials, no arrows.
 */
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { visible, workspace, profile, profiles } = useActiveContext()

const list = computed(() => profiles.data.value?.items ?? [])
/** The chosen profile's photo, else the client's first profile's. */
const photo = computed(() => {
  const shown = profile.value ?? list.value[0]
  return shown ? profilePhoto(shown) : null
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
    icon: 'i-lucide-layout-grid',
    type: 'checkbox' as const,
    checked: workspace.value === null,
    onSelect: () => pick(null),
  },
  ...visible.value.flatMap((w) => {
    const current = workspace.value?.id === w.id
    return [
      {
        label: w.name,
        avatar: { src: current ? (photo.value ?? undefined) : undefined, alt: w.name },
        type: 'checkbox' as const,
        checked: current && profile.value === null,
        onSelect: () => pick(w.slug),
      },
      // the profiles of the client in context, right under it, only when it has more than one
      ...(current && list.value.length > 1
        ? list.value.map((p) => ({
            label: t('context.profile', { name: profileName(p) }),
            avatar: { src: profilePhoto(p) ?? undefined, alt: profileName(p) },
            type: 'checkbox' as const,
            checked: profile.value?.key === p.key,
            class: 'ps-6',
            onSelect: () => pick(w.slug, p.id),
          }))
        : []),
    ]
  }),
])
</script>

<template>
  <UDropdownMenu :items="items" :ui="{ content: 'min-w-60 max-h-96' }">
    <button
      type="button"
      :disabled="!ready"
      :aria-label="$t('context.label')"
      class="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1 text-start transition-colors duration-150 hover:bg-(--app-nav-hover) aria-expanded:bg-(--app-nav-hover)"
    >
      <RowAvatar v-if="workspace" :name="workspace.name" :src="photo" />
      <span
        v-else
        class="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-(--app-surface) text-(--app-text-muted)"
        aria-hidden="true"
      >
        <UIcon name="i-lucide-layout-grid" class="size-4" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm">{{ workspace?.name ?? $t('context.all') }}</span>
        <span v-if="workspace && profile" class="block truncate text-xs text-(--app-text-muted)">
          {{ profileName(profile) }}
        </span>
      </span>
    </button>
  </UDropdownMenu>
</template>

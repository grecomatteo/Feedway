<script setup lang="ts">
/**
 * "Tutti i clienti", one workspace the person sees, or one profile of that workspace (§14.6),
 * kept in the address (`?spazio=`, `&profilo=`). What is unknown or not visible falls back to
 * "Tutti i clienti" (useActiveContext). Two shapes (D-81): `side`, the 44 px box of the sidebar
 * with a popover under it (screen 04); `top`, the name in the phone's only row at the top with a
 * sheet from the bottom.
 */
const props = withDefaults(defineProps<{ variant?: 'side' | 'top' }>(), { variant: 'side' })

// the menu opens only once the page runs in the browser: a click before that would be lost
const ready = useHydrated()
const org = useOrganization()
const { workspace, profile, profiles } = useActiveContext()
const open = ref(false)

const list = computed(() => profiles.data.value?.items ?? [])
/** The chosen profile's photo, else the first one among the client's profiles, as the list. */
const photo = computed(() => {
  if (profile.value) return profilePhoto(profile.value)
  for (const p of list.value) {
    const found = profilePhoto(p)
    if (found) return found
  }
  return workspace.value?.photoUrl ?? null
})
const avatar = computed(() =>
  workspace.value
    ? { name: workspace.value.name, src: photo.value, kind: 'client' as const }
    : {
        name: org.organization.value?.name ?? '',
        src: org.organization.value?.logoUrl ?? null,
        kind: 'agency' as const,
      },
)
// «Nuovo cliente» opens a dialog on the clients' page: the focus must not come back here, or the
// dialog would close as soon as it opens
let away = false
const close = (leaving = false) => {
  away = leaving
  open.value = false
}
// the popover's own focus goes to the search, which the panel focuses itself
const keepFocus = (event: Event) => event.preventDefault()
const focusBack = (event: Event) => {
  if (away) event.preventDefault()
  away = false
}
</script>

<template>
  <UPopover
    v-if="props.variant === 'side'"
    v-model:open="open"
    :content="{
      side: 'bottom',
      align: 'start',
      sideOffset: 0,
      onOpenAutoFocus: keepFocus,
      onCloseAutoFocus: focusBack,
    }"
    :ui="{
      content:
        'w-[300px] rounded-xl border border-(--app-border) bg-(--app-surface) p-1.5 shadow-(--app-shadow-2) ring-0',
    }"
  >
    <button
      type="button"
      :disabled="!ready"
      class="mb-2 flex h-11 w-full items-center gap-2.5 rounded-control border border-(--app-border-strong) bg-(--app-surface) ps-2 pe-2.5 text-start shadow-(--app-shadow-1) transition-colors duration-150 hover:bg-(--app-surface-sunken)"
    >
      <Avatar :name="avatar.name" :src="avatar.src" :kind="avatar.kind" :size="22" />
      <span class="min-w-0 flex-1 leading-[1.125rem]">
        <span class="sr-only">{{ $t('context.label') }}: </span>
        <span class="block truncate font-semibold">{{ workspace?.name ?? $t('context.all') }}</span>
        <span
          v-if="workspace && profile"
          class="block truncate text-caption text-(--app-text-muted)"
          >{{ profileName(profile) }}</span
        >
      </span>
      <UIcon
        name="i-lucide-chevrons-up-down"
        class="size-4 shrink-0 text-(--app-text-muted)"
        aria-hidden="true"
      />
    </button>
    <template #content>
      <ContextSwitcherPanel @done="close" />
    </template>
  </UPopover>

  <UDrawer
    v-else
    v-model:open="open"
    :title="$t('context.label')"
    :handle="false"
    :content="{ onCloseAutoFocus: focusBack }"
    :ui="{
      overlay: 'bg-[rgb(36_35_33/0.4)]',
      content:
        'max-h-[80vh] rounded-t-2xl border border-b-0 border-(--app-border) bg-(--app-surface) ring-0',
      container: 'gap-0 p-2.5 pb-[max(1.5rem,env(safe-area-inset-bottom))]',
      header: 'sr-only',
    }"
  >
    <button
      type="button"
      :disabled="!ready"
      class="flex h-10 min-w-0 items-center gap-2 rounded-control px-1.5 text-start font-semibold"
    >
      <Avatar :name="avatar.name" :src="avatar.src" :kind="avatar.kind" :size="22" />
      <span class="min-w-0 truncate">
        <span class="sr-only">{{ $t('context.label') }}: </span
        >{{ workspace?.name ?? $t('context.all')
        }}<span v-if="workspace && profile" class="font-normal text-(--app-text-muted)">
          {{ profileName(profile) }}</span
        >
      </span>
      <UIcon
        name="i-lucide-chevron-down"
        class="size-4 shrink-0 text-(--app-text-muted)"
        aria-hidden="true"
      />
    </button>
    <template #body>
      <ContextSwitcherPanel phone @done="close" />
    </template>
  </UDrawer>
</template>

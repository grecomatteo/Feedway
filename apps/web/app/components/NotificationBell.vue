<script setup lang="ts">
/**
 * The bell of the shell (D-87.6, screen 05): an orange dot while something is unread, the number
 * for the screen reader. On a computer the centre opens beside the sidebar; on a phone from the
 * bottom, full width. The count comes from `useBellPolling` in the layout (plan 08, Scelta 5).
 */
const props = withDefaults(defineProps<{ variant?: 'side' | 'top' }>(), { variant: 'side' })

const ready = useHydrated()
const open = ref(false)
const { unread } = useNotifications()
const { t } = useI18n()
const label = computed(() =>
  unread.value
    ? t('notifications.bellUnread', { n: unread.value }, unread.value)
    : t('notifications.bell'),
)
const close = () => (open.value = false)
</script>

<template>
  <UPopover
    v-if="props.variant === 'side'"
    v-model:open="open"
    :content="{ side: 'right', align: 'start', sideOffset: 14, alignOffset: -6 }"
    :ui="{
      content:
        'w-[400px] max-h-[min(640px,calc(100dvh-24px))] overflow-y-auto rounded-xl border border-(--app-border) bg-(--app-surface) shadow-(--app-shadow-2) ring-0',
    }"
  >
    <button
      type="button"
      :disabled="!ready"
      :aria-label="label"
      aria-haspopup="dialog"
      class="relative flex size-control-sm items-center justify-center rounded-control text-(--app-text) hover:bg-(--app-nav-hover) aria-expanded:bg-(--app-nav-hover)"
      data-bell
    >
      <UIcon name="i-lucide-bell" class="size-4" aria-hidden="true" />
      <span
        v-if="unread"
        class="absolute end-1.5 top-1.5 size-2 rounded-full bg-(--app-brand) ring-2 ring-(--app-nav-bg)"
        aria-hidden="true"
        data-bell-dot
      />
    </button>
    <template #content>
      <NotificationPanel @close="close" />
    </template>
  </UPopover>

  <UDrawer
    v-else
    v-model:open="open"
    :title="$t('notifications.title')"
    :handle="false"
    :ui="{
      overlay: 'bg-[rgb(36_35_33/0.4)]',
      content:
        'max-h-[85vh] rounded-t-2xl border border-b-0 border-(--app-border) bg-(--app-surface) ring-0',
      container: 'gap-0 overflow-y-auto p-2.5 pb-[max(1.5rem,env(safe-area-inset-bottom))]',
      header: 'sr-only',
    }"
  >
    <button
      type="button"
      :disabled="!ready"
      :aria-label="label"
      aria-haspopup="dialog"
      class="relative flex size-11 shrink-0 items-center justify-center rounded-control text-(--app-text)"
      data-bell
    >
      <UIcon name="i-lucide-bell" class="size-5" aria-hidden="true" />
      <span
        v-if="unread"
        class="absolute end-2.5 top-2.5 size-2 rounded-full bg-(--app-brand) ring-2 ring-(--app-bg)"
        aria-hidden="true"
        data-bell-dot
      />
    </button>
    <template #body>
      <NotificationPanel phone @close="close" />
    </template>
  </UDrawer>
</template>

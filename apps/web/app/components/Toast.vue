<script setup lang="ts">
/**
 * The confirmation at the bottom of the page (D-81, screen 12): charcoal, one line, a tick and a
 * link to what was just done. It goes away by itself after `duration` ms (D-45: five seconds),
 * but not while the pointer or the focus is on it, so the link can be reached.
 * Keep it mounted and drive it with `v-model:open`: the live region must already be on the page
 * when the message arrives, or a screen reader does not announce it. Closed, it is only that
 * empty region (no `status` role), so a page's own status line stays the only one.
 */
const props = withDefaults(
  defineProps<{
    message: string
    linkLabel?: string
    to?: string
    /** a button instead of the link, such as «Annulla» after a move */
    actionLabel?: string
    duration?: number
    /** in the flow of the page instead of over it: the system board */
    inline?: boolean
  }>(),
  { linkLabel: undefined, to: undefined, actionLabel: undefined, duration: 5000, inline: false },
)
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ action: [] }>()
function act() {
  open.value = false
  emit('action')
}
let timer: ReturnType<typeof setTimeout> | undefined
const held = ref(false)

function arm() {
  clearTimeout(timer)
  if (import.meta.client && open.value && !held.value && props.duration > 0)
    timer = setTimeout(() => (open.value = false), props.duration)
}
// a closed toast is no longer held: its link may have gone with the focus on it, and a removed
// element sends no focusout; a new message starts the five seconds again
watch(open, (now) => {
  if (!now) held.value = false
  arm()
})
watch(() => props.message, arm)
onMounted(arm)
onBeforeUnmount(() => clearTimeout(timer))

function hold(on: boolean) {
  held.value = on
  arm()
}
function leaveFocus(e: FocusEvent) {
  const to = e.relatedTarget
  if (!(to instanceof Node && (e.currentTarget as HTMLElement).contains(to))) hold(false)
}
</script>

<template>
  <div
    :role="open ? 'status' : undefined"
    aria-live="polite"
    :class="
      inline
        ? 'w-fit max-w-full'
        : 'fixed bottom-7 left-1/2 z-50 -translate-x-1/2 max-md:right-3 max-md:bottom-[72px] max-md:left-3 max-md:translate-x-0'
    "
    @pointerenter="hold(true)"
    @pointerleave="hold(false)"
    @focusin="hold(true)"
    @focusout="leaveFocus"
  >
    <div
      v-if="open"
      class="flex h-11 items-center gap-2.5 rounded-card bg-(--app-toast) pr-1.5 pl-3.5 font-medium whitespace-nowrap text-(--app-on-toast) shadow-2 max-md:justify-between max-md:text-detail"
      data-toast
    >
      <span class="inline-flex min-w-0 items-center gap-2">
        <UIcon
          name="i-lucide-circle-check"
          class="size-4 shrink-0 text-(--app-toast-icon)"
          aria-hidden="true"
        />
        <span class="truncate">{{ message }}</span>
      </span>
      <NuxtLink
        v-if="to && linkLabel"
        :to="to"
        class="inline-flex h-8 items-center rounded-thumb max-md:h-11 px-2.5 font-semibold underline underline-offset-3"
        @click="open = false"
        >{{ linkLabel }}</NuxtLink
      >
      <button
        v-else-if="actionLabel"
        type="button"
        class="inline-flex h-8 items-center rounded-thumb px-2.5 font-semibold underline underline-offset-3 max-md:h-11"
        data-toast-action
        @click="act"
      >
        {{ actionLabel }}
      </button>
    </div>
  </div>
</template>

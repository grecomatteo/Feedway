<script setup lang="ts">
/**
 * The confirmation at the bottom of the page (D-81, screen 12): charcoal, one line, a tick and a
 * link to what was just done. It goes away by itself after `duration` ms (D-45: five seconds).
 */
const props = withDefaults(
  defineProps<{
    message: string
    linkLabel?: string
    to?: string
    duration?: number
    /** in the flow of the page instead of over it: the system board */
    inline?: boolean
  }>(),
  { linkLabel: undefined, to: undefined, duration: 5000, inline: false },
)
const open = defineModel<boolean>('open', { default: false })
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  open,
  (v) => {
    clearTimeout(timer)
    if (v && props.duration > 0) timer = setTimeout(() => (open.value = false), props.duration)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div role="status" aria-live="polite" class="contents">
    <div
      v-if="open"
      class="flex h-11 items-center gap-2.5 rounded-card bg-(--app-toast) pr-1.5 pl-3.5 font-medium whitespace-nowrap text-(--app-on-toast) shadow-2"
      :class="
        inline
          ? 'w-fit max-w-full'
          : 'fixed bottom-7 left-1/2 z-50 -translate-x-1/2 max-md:right-3 max-md:bottom-[72px] max-md:left-3 max-md:translate-x-0 max-md:justify-between'
      "
      data-toast
    >
      <span class="inline-flex min-w-0 items-center gap-2">
        <UIcon
          name="i-lucide-circle-check"
          class="size-4 shrink-0 text-[#6FD39C] dark:text-[#17693F]"
        />
        <span class="truncate">{{ message }}</span>
      </span>
      <NuxtLink
        v-if="to && linkLabel"
        :to="to"
        class="inline-flex h-8 items-center rounded-thumb px-2.5 font-semibold underline underline-offset-3"
        >{{ linkLabel }}</NuxtLink
      >
    </div>
  </div>
</template>

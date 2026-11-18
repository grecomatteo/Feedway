<script setup lang="ts">
/**
 * The phone around a preview (design E4): the app's own colours, white for the feed and the
 * Page's posts, black for reels and stories, in the panel's dark theme too.
 */
defineProps<{ dark?: boolean; time: string }>()
</script>

<template>
  <div
    class="relative mx-auto flex aspect-[9/18.5] w-full max-w-90 flex-col overflow-hidden rounded-[2.25rem] border-[6px] border-[#1c1b19] shadow-[0_8px_24px_rgb(36_35_33/0.18)]"
    :class="dark ? 'bg-black text-white' : 'bg-white text-[#141414]'"
    data-phone
  >
    <div
      class="flex h-7 shrink-0 items-center justify-between px-5 text-[0.6875rem] font-semibold"
      :class="dark ? 'absolute inset-x-0 top-0 z-20 text-white' : ''"
      aria-hidden="true"
    >
      <span>{{ time }}</span>
      <span class="flex items-center gap-1">
        <UIcon name="i-lucide-signal" class="size-3" />
        <UIcon name="i-lucide-wifi" class="size-3" />
        <UIcon name="i-lucide-battery-full" class="size-3.5" />
      </span>
    </div>
    <div class="relative min-h-0 flex-1 overflow-y-auto">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * A row of a settings group (D-81): the label on the left, 200 wide, the value and its action on
 * the right. On a phone the value goes under the label, or beside it with `inline` (a switch).
 */
withDefaults(defineProps<{ label: string; inline?: boolean; for?: string }>(), {
  inline: false,
  for: undefined,
})
</script>

<template>
  <div
    class="grid min-h-15 grid-cols-[200px_minmax(0,1fr)] items-center gap-x-6 border-t border-(--app-border) px-4 py-3 first:border-t-0 max-md:gap-2"
    :class="inline ? 'max-md:grid-cols-[minmax(0,1fr)_auto]' : 'max-md:grid-cols-1'"
    data-settings-row
  >
    <component :is="$props.for ? 'label' : 'span'" :for="$props.for" class="font-medium">
      {{ label }}
    </component>
    <div class="flex min-w-0 flex-wrap items-center gap-3">
      <slot />
    </div>
  </div>
</template>

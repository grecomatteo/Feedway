<script setup lang="ts">
/**
 * A row of a settings group (D-81): the label on the left, 200 wide, the value and its action on
 * the right; on a phone the value goes under the label. `inline` keeps the action at the end of
 * the row on every size (a switch, «Cambia», «Gestisci»), with `hint` under the label («Cambiata
 * il 3 ottobre»).
 */
withDefaults(
  defineProps<{ label: string; inline?: boolean; for?: string; hint?: string | null }>(),
  { inline: false, for: undefined, hint: null },
)
</script>

<template>
  <div
    class="grid min-h-15 items-center gap-x-6 border-t border-(--app-border) px-4 py-3 first:border-t-0 max-md:gap-y-2"
    :class="
      inline
        ? 'grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3'
        : 'grid-cols-[200px_minmax(0,1fr)] max-md:grid-cols-1'
    "
    data-settings-row
  >
    <div class="min-w-0">
      <component :is="$props.for ? 'label' : 'span'" :for="$props.for" class="block font-medium">
        {{ label }}
      </component>
      <span v-if="hint" class="block text-detail text-(--app-text-muted)">{{ hint }}</span>
      <slot name="hint" />
    </div>
    <div class="flex min-w-0 flex-wrap items-center gap-3" :class="inline ? 'justify-end' : ''">
      <slot />
    </div>
  </div>
</template>

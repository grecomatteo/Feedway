<script setup lang="ts">
/**
 * A read that failed (Task R9): one row on the surface the list would have, what did not load
 * and «Riprova» at the end, as «Da sistemare» does on Oggi. An alert, so it is heard at once.
 */
withDefaults(defineProps<{ text: string; retry?: boolean }>(), { retry: true })
defineEmits<{ retry: [] }>()
</script>

<template>
  <div
    role="alert"
    class="flex min-h-row flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-(--app-border) bg-(--app-surface) px-4 py-3 max-md:px-3.5"
    data-load-failed
  >
    <UIcon
      name="i-lucide-circle-alert"
      class="size-4 shrink-0 text-(--app-danger)"
      aria-hidden="true"
    />
    <!-- the row is the measure: «Riprova» at its end, not after 75 characters (the cap of main.css is unlayered) -->
    <p class="max-w-none! min-w-0 flex-1">{{ text }}</p>
    <UButton v-if="retry" color="neutral" variant="outline" size="sm" @click="$emit('retry')">
      {{ $t('account.retry') }}
    </UButton>
  </div>
</template>

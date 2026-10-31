<script setup lang="ts">
/**
 * A first hint while typing. The server has the last word (length, common passwords, the
 * person's own name and email) and says why when it refuses.
 */
const props = defineProps<{ password: string }>()

const level = computed<0 | 1 | 2 | 3>(() => {
  const p = props.password
  if (p === '') return 0
  if (p.length < 12) return 1
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length
  return p.length >= 16 || (p.length >= 12 && kinds >= 3) ? 3 : 2
})
const labels = ['', 'password.tooShort', 'password.fair', 'password.good'] as const
const colors = ['', 'bg-(--app-danger)', 'bg-(--app-warning)', 'bg-(--app-success)'] as const
</script>

<template>
  <div v-if="level > 0" class="space-y-1" aria-live="polite">
    <div class="flex gap-1" aria-hidden="true">
      <span
        v-for="i in 3"
        :key="i"
        class="h-1.5 flex-1 rounded-full"
        :class="i <= level ? colors[level] : 'bg-(--app-surface-sunken)'"
      />
    </div>
    <p class="text-sm text-(--app-text-muted)">{{ $t(labels[level]) }}</p>
  </div>
</template>

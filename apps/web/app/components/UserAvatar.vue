<script setup lang="ts">
/** Initials on a colour picked from the name, until profile photos arrive (Task 26). */
const props = defineProps<{ name: string }>()
const initials = computed(() =>
  props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0]?.toUpperCase() ?? '')
    .join(''),
)
// light backgrounds with dark text: readable in both themes
const COLORS = ['#DCE7F7', '#E3F3EA', '#FFF1D2', '#FCE9E7', '#EDE4F7', '#FFE8DA'] as const
const color = computed(() => {
  let h = 0
  for (const c of props.name) h = (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0
  return COLORS[h % COLORS.length]
})
</script>

<template>
  <span
    class="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-[#242321]"
    :style="{ backgroundColor: color }"
    aria-hidden="true"
  >
    {{ initials }}
  </span>
</template>

<script setup lang="ts">
/** The profile photo, or initials on a colour picked from the name when there is none. */
const props = withDefaults(
  defineProps<{ name: string; src?: string | null; size?: 'sm' | 'md' | 'lg' }>(),
  { src: null, size: 'sm' },
)
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
// the small file is enough up to 64 px (the URL names the 256 px one)
const photo = computed(() =>
  props.src && props.size !== 'lg' ? props.src.replace('/avatar/256', '/avatar/64') : props.src,
)
const failed = ref(false)
watch(photo, () => {
  failed.value = false
})
</script>

<template>
  <img
    v-if="photo && !failed"
    :src="photo"
    alt=""
    :class="[
      'shrink-0 rounded-full bg-(--app-surface-sunken) object-cover',
      { sm: 'size-8', md: 'size-10', lg: 'size-24' }[size],
    ]"
    :width="{ sm: 32, md: 40, lg: 96 }[size]"
    :height="{ sm: 32, md: 40, lg: 96 }[size]"
    aria-hidden="true"
    @error="failed = true"
  />
  <span
    v-else
    :class="[
      'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-[#242321]',
      { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-24 text-2xl' }[size],
    ]"
    :style="{ backgroundColor: color }"
    aria-hidden="true"
  >
    {{ initials }}
  </span>
</template>

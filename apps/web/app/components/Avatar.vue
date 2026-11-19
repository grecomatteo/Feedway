<script setup lang="ts">
/**
 * Who or what a row is about (D-81): a client is a rounded square, a person a circle, the agency a
 * charcoal square. Warm grey with the initials, or the real picture; never a pastel colour.
 */
const props = withDefaults(
  defineProps<{
    name: string
    src?: string | null
    kind?: 'client' | 'person' | 'agency'
    /** In px: 22 inside a chip, 28 in a row, 40 at the head of a section, 56 at the top of a page. */
    size?: number
  }>(),
  { src: null, kind: 'client', size: 28 },
)
const initials = computed(() =>
  props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0]?.toUpperCase() ?? '')
    .join(''),
)
const radius = computed(() =>
  props.kind === 'person' ? '50%' : `${String(Math.round(props.size / 4))}px`,
)
const fontSize = computed(() => {
  if (props.size <= 24) return '9.5px'
  if (props.size <= 32) return '11px'
  if (props.size <= 44) return '14px'
  return `${String(Math.round(props.size * 0.32))}px`
})
// a small copy is enough up to 64 px (the URL names the 256 px one)
const photo = computed(() =>
  props.src && props.size <= 64 ? props.src.replace('/avatar/256', '/avatar/64') : props.src,
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
    class="shrink-0 bg-(--app-surface-sunken) object-cover outline-1 -outline-offset-1 outline-(--app-img-outline)"
    :style="{ width: `${size}px`, height: `${size}px`, borderRadius: radius }"
    :width="size"
    :height="size"
    aria-hidden="true"
    referrerpolicy="no-referrer"
    :data-avatar="kind"
    @error="failed = true"
  />
  <span
    v-else
    class="inline-grid shrink-0 place-items-center border font-semibold tracking-[0.02em]"
    :class="
      kind === 'agency'
        ? 'border-(--app-text) bg-(--app-text) text-(--app-bg)'
        : 'border-(--app-border) bg-(--app-surface-sunken) text-(--app-text)'
    "
    :style="{ width: `${size}px`, height: `${size}px`, borderRadius: radius, fontSize }"
    aria-hidden="true"
    :data-avatar="kind"
  >
    {{ initials }}
  </span>
</template>

<script setup lang="ts">
/**
 * The picture at the start of a sidebar row: a client's Instagram or Page photo, round, or an
 * agency's square tile. Initials when there is no picture or it does not load (Meta's addresses
 * expire after some days).
 */
const props = withDefaults(
  defineProps<{ name: string; src?: string | null; shape?: 'round' | 'square' }>(),
  { src: null, shape: 'round' },
)
const initials = computed(() =>
  props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0]?.toUpperCase() ?? '')
    .join(''),
)
const failed = ref(false)
watch(
  () => props.src,
  () => {
    failed.value = false
  },
)
const radius = computed(() => (props.shape === 'square' ? 'rounded-md' : 'rounded-full'))
</script>

<template>
  <img
    v-if="src && !failed"
    :src="src"
    alt=""
    :class="['size-8 shrink-0 bg-(--app-surface-sunken) object-cover', radius]"
    width="32"
    height="32"
    aria-hidden="true"
    referrerpolicy="no-referrer"
    @error="failed = true"
  />
  <span
    v-else
    :class="[
      'inline-flex size-8 shrink-0 items-center justify-center text-xs font-semibold',
      radius,
      shape === 'square'
        ? 'bg-(--app-text) text-(--app-surface)'
        : 'bg-(--app-brand-soft) text-(--app-text)',
    ]"
    aria-hidden="true"
  >
    {{ initials }}
  </span>
</template>

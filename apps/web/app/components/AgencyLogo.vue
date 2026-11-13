<script setup lang="ts">
/**
 * The agency's logo, whole inside its square (never cropped: many logos are not square), or the
 * dark tile with the initials when there is none or it does not load. `sm` is the 32 px of the
 * sidebar and reads the 64 px file; `lg` the settings, with the 256 px one.
 */
const props = withDefaults(
  defineProps<{ name: string; src?: string | null; size?: 'sm' | 'lg' }>(),
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
// the URL names the 256 px file
const file = computed(() =>
  props.src && props.size === 'sm' ? props.src.replace('/logo/256', '/logo/64') : props.src,
)
const failed = ref(false)
watch(file, () => {
  failed.value = false
})
const box = computed(() => (props.size === 'lg' ? 'size-24 rounded-xl' : 'size-8 rounded-md'))
</script>

<template>
  <img
    v-if="file && !failed"
    :src="file"
    :alt="size === 'lg' ? $t('logo.current') : ''"
    :class="['shrink-0 border border-(--app-border) bg-(--app-surface) object-contain', box]"
    :width="size === 'lg' ? 96 : 32"
    :height="size === 'lg' ? 96 : 32"
    :aria-hidden="size === 'lg' ? undefined : 'true'"
    @error="failed = true"
  />
  <span
    v-else
    :class="[
      'inline-flex shrink-0 items-center justify-center bg-(--app-text) font-semibold text-(--app-surface)',
      box,
      size === 'lg' ? 'text-2xl' : 'text-xs',
    ]"
    aria-hidden="true"
  >
    {{ initials }}
  </span>
</template>

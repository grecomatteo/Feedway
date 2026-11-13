<script setup lang="ts">
/**
 * The picture at the start of a row: a client's Instagram or Page photo as Feedway keeps it,
 * round (the agency's logo is `AgencyLogo`). Initials when there is no picture yet or it does not
 * load.
 */
const props = withDefaults(defineProps<{ name: string; src?: string | null }>(), { src: null })
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
</script>

<template>
  <img
    v-if="src && !failed"
    :src="src"
    alt=""
    class="size-8 shrink-0 rounded-full bg-(--app-surface-sunken) object-cover"
    width="32"
    height="32"
    aria-hidden="true"
    referrerpolicy="no-referrer"
    @error="failed = true"
  />
  <span
    v-else
    class="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-(--app-brand-soft) text-xs font-semibold text-(--app-text)"
    aria-hidden="true"
  >
    {{ initials }}
  </span>
</template>

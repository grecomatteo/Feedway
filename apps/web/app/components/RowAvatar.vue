<script setup lang="ts">
/**
 * The picture at the start of a row: a client's Instagram or Page photo as Feedway keeps it,
 * round (the agency's logo is `AgencyLogo`). Initials when there is no picture yet or it does not
 * load.
 */
const props = withDefaults(
  defineProps<{ name: string; src?: string | null; size?: 'row' | 'page' }>(),
  { src: null, size: 'row' },
)
/** `page`: 56 px, at the top of the client's page, from the 256 px copy. */
const big = computed(() => props.size === 'page')
const initials = computed(() =>
  props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0]?.toUpperCase() ?? '')
    .join(''),
)
/** At 32 px the 64 px copy is enough, also on a dense screen. */
const small = computed(() =>
  big.value ? props.src : (props.src?.replace('/avatar/256?', '/avatar/64?') ?? null),
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
    v-if="small && !failed"
    :src="small ?? undefined"
    alt=""
    class="shrink-0 rounded-full bg-(--app-surface-sunken) object-cover"
    :class="big ? 'size-14' : 'size-8'"
    :width="big ? 56 : 32"
    :height="big ? 56 : 32"
    aria-hidden="true"
    referrerpolicy="no-referrer"
    @error="failed = true"
  />
  <span
    v-else
    class="inline-flex shrink-0 items-center justify-center rounded-full bg-(--app-brand-soft) font-semibold text-(--app-text)"
    :class="big ? 'size-14 text-lg' : 'size-8 text-xs'"
    aria-hidden="true"
  >
    {{ initials }}
  </span>
</template>

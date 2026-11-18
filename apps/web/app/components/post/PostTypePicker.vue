<script setup lang="ts">
import { typeOptions, type PostType } from '~/utils/post-editor'

/**
 * «Tipo» (D-60, §11.2 point 2; design E1): four buttons, none chosen with no file. The types
 * that do not go with the files are off, with the reason written under them for everyone (not
 * only on hover) and read with the button.
 */
const props = defineProps<{
  type: PostType | null
  kinds: { kind: 'image' | 'video' | null }[]
  disabled?: boolean
}>()
const emit = defineEmits<{ choose: [PostType] }>()
const { t } = useI18n()

const ICONS: Record<PostType, string> = {
  photo: 'i-lucide-image',
  carousel: 'i-lucide-gallery-horizontal-end',
  reel: 'i-lucide-clapperboard',
  story: 'i-lucide-circle-dashed',
}
const options = computed(() => typeOptions(props.kinds))
const reasons = computed(() =>
  options.value
    .filter((o) => !o.enabled && o.reason)
    .map((o) => t(`posts.type.off.${o.reason}`))
    .filter((r, i, all) => all.indexOf(r) === i),
)
</script>

<template>
  <section aria-labelledby="post-type" class="flex flex-col gap-3">
    <h2 id="post-type" class="text-lg">{{ $t('posts.type.title') }}</h2>
    <div
      role="group"
      :aria-label="$t('posts.type.title')"
      class="grid grid-cols-2 gap-2 sm:grid-cols-4"
    >
      <button
        v-for="o in options"
        :key="o.type"
        type="button"
        :aria-pressed="type === o.type"
        :aria-disabled="!o.enabled || disabled"
        :aria-describedby="!o.enabled ? 'post-type-why' : undefined"
        :data-type="o.type"
        class="flex min-h-12 items-center justify-center gap-2 rounded-lg border px-3 text-sm transition-colors"
        :class="[
          type === o.type
            ? 'border-2 border-(--app-text) bg-(--app-brand-soft) font-semibold'
            : 'border-(--app-border) bg-(--app-surface) hover:bg-(--app-surface-sunken)',
          !o.enabled || disabled ? 'cursor-not-allowed opacity-50' : '',
        ]"
        @click="o.enabled && !disabled && emit('choose', o.type)"
      >
        <UIcon :name="ICONS[o.type]" class="size-4" aria-hidden="true" />
        {{ $t(`posts.type.${o.type}`) }}
        <UIcon v-if="type === o.type" name="i-lucide-check" class="size-4" aria-hidden="true" />
      </button>
    </div>
    <p
      v-if="reasons.length > 0"
      id="post-type-why"
      class="flex items-start gap-2 text-sm text-(--app-text-muted)"
    >
      <UIcon name="i-lucide-info" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{{ reasons.join(' ') }}</span>
    </p>
  </section>
</template>
